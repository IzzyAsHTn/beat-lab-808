import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  process.argv[2] ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const core = createRequire(import.meta.url)(path.join(root, "lab-core.js"));
const testCore = {
  ...core,
  checkAudioFileDuration: async () => 1,
};
const source = (name) => fs.readFileSync(path.join(root, name + ".js"), "utf8");
const seq = source("sequencer"),
  drums = source("index"),
  cut = source("samples"),
  effectsSource = source("effects"),
  game = source("groove-mystere");
// Production handlers run unchanged with controlled completion order and audio/storage doubles.
function block(s, start) {
  let quote = "",
    escape = false,
    depth = 0;
  for (let i = s.indexOf("{", start); i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === quote) quote = "";
      continue;
    }
    if (['"', "'", "`"].includes(c)) {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  throw Error("Unclosed block");
}
const fn = (s, name) => {
  const i = s.indexOf("function " + name + "(");
  assert.ok(i >= 0, name);
  return block(s, i);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const results = [];
async function test(name, run) {
  await run();
  results.push(name);
}
function bind(scope, script) {
  vm.createContext(scope);
  vm.runInContext(script, scope);
  return scope;
}
function runCapturedHandler(sourceText, marker, scope) {
  const start = sourceText.indexOf(marker);
  assert.ok(start >= 0, `Missing handler: ${marker}`);
  const captured = block(sourceText, start);
  const body = captured.slice(captured.indexOf("{"));
  bind(scope, `globalThis.capturedHandler = () => ${body};`);
  scope.capturedHandler();
  return scope;
}
await test("Both sequencers stop cleanly when the page becomes hidden", async () => {
  for (const sourceText of [drums, seq]) {
    const scope = {
      document: { hidden: true },
      playing: true,
      starting: false,
      status: { textContent: "En lecture" },
      stopCalls: 0,
    };
    scope.stop = () => {
      scope.stopCalls++;
      scope.playing = false;
    };
    runCapturedHandler(
      sourceText,
      'document.addEventListener("visibilitychange", () => {',
      scope,
    );
    assert.equal(scope.stopCalls, 1);
    assert.match(scope.status.textContent, /arrière-plan/);
    assert.equal(scope.playing, false);
  }
});
await test("Both sequencers stop after an audio-context interruption", async () => {
  for (const sourceText of [drums, seq]) {
    const scope = {
      ctx: { state: "suspended" },
      playing: true,
      starting: false,
      status: { textContent: "En lecture" },
      stopCalls: 0,
    };
    scope.stop = () => {
      scope.stopCalls++;
      scope.playing = false;
    };
    const marker = 'ctx.addEventListener("statechange", (event) => {';
    const registration = sourceText.indexOf(marker);
    assert.ok(registration >= 0);
    const callbackStart = sourceText.indexOf("(event) =>", registration);
    const body = block(sourceText, sourceText.indexOf("{", callbackStart));
    const listener = vm.runInNewContext(`(event) => ${body}`, scope);
    listener({ currentTarget: scope.ctx });
    assert.equal(scope.stopCalls, 1);
    assert.match(scope.status.textContent, /interruption audio/);
    assert.equal(scope.playing, false);
  }
});
await test("An obsolete audio context cannot stop the current sequencer", async () => {
  for (const sourceText of [drums, seq]) {
    const current = { state: "running" },
      stale = { state: "suspended" },
      scope = {
        ctx: current,
        playing: true,
        starting: false,
        status: { textContent: "En lecture" },
      },
      marker = 'ctx.addEventListener("statechange", (event) => {',
      registration = sourceText.indexOf(marker),
      callbackStart = sourceText.indexOf("(event) =>", registration),
      body = block(sourceText, sourceText.indexOf("{", callbackStart)),
      listener = vm.runInNewContext(`(event) => ${body}`, scope);
    let stopCalls = 0;
    scope.stop = () => stopCalls++;
    listener({ currentTarget: stale });
    assert.equal(stopCalls, 0);
    current.state = "suspended";
    listener({ currentTarget: current });
    assert.equal(stopCalls, 1);
  }
});
await test("Sequencer restores a saved length only when that length is an available option", async () => {
  const apply = fn(seq, "restoreLengthPreference");
  const scope = bind(
    { select: { options: [{ value: "8" }, { value: "16" }], value: "16" } },
    apply + ";restoreLengthPreference(select,32);",
  );
  assert.equal(scope.select.value, "16");
  scope.select.options.push({ value: "32" });
  vm.runInContext("restoreLengthPreference(select,32)", scope);
  assert.equal(scope.select.value, "32");
  assert.deepEqual(
    Array.from(fs.readFileSync(path.join(root, "sequencer.html"), "utf8").matchAll(/<option value="(\d+)"/g), (m) => m[1]),
    ["8", "16"],
  );
});
await test("808 step names keep track position and do not duplicate toggle state", async () => {
  const stepLabel = fn(drums, "stepAccessibleLabel");
  const label = vm.runInNewContext(
    "const tracks=[{label:'KICK',steps:[false]}];" +
      stepLabel +
      ";stepAccessibleLabel(0,0)",
  );
  assert.equal(label, "KICK, piste 1 sur 1, pas 1 sur 16");
  assert.doesNotMatch(label, /activé|désactivé/);
  const attributes = {};
  const button = {
    classList: { toggle() {} },
    setAttribute(name, value) { attributes[name] = value; },
  };
  const updateVoiceButton = fn(drums, "updateVoiceButton");
  vm.runInNewContext(
    `const button=${JSON.stringify({})};` + updateVoiceButton +
      `;updateVoiceButton(globalThis.testButton,{label:"Kick",muted:true,solo:false},"mute");`,
    { testButton: button, attributes },
  );
  assert.equal(attributes["aria-pressed"], "true");
  assert.equal(attributes["aria-label"], "Kick · Mute");
  assert.equal(button.title, "Kick · Mute");
  assert.doesNotMatch(button.title, /réactiver|couper/);
});
await test("Clear and remove actions honor their confirmation dialog and restore complete labels", async () => {
  const steps = [true, true];
  const attributes = [];
  const drumScope = {
    window: { confirm: (message) => { drumScope.confirmation = message; return false; } },
    tracks: [{ steps }],
    cells: [[...steps].map(() => ({
      classList: { remove() {} },
      setAttribute(name, value) { attributes.push([name, value]); },
    }))],
    status: { textContent: "" },
    saves: 0,
  };
  drumScope.stepAccessibleLabel = (track, step) => `KICK, piste 1 sur 8, pas ${step + 1} sur 16`;
  drumScope.savePattern = () => { drumScope.saves++; };
  runCapturedHandler(
    drums,
    'document.querySelector("#clear").addEventListener("click", () => {',
    drumScope,
  );
  assert.deepEqual(steps, [true, true]);
  assert.equal(drumScope.saves, 0);
  drumScope.window.confirm = () => true;
  drumScope.capturedHandler();
  assert.deepEqual(steps, [0, 0]);
  assert.equal(drumScope.saves, 1);
  assert.deepEqual(attributes.filter(([name]) => name === "aria-label").map(([, value]) => value), [
    "KICK, piste 1 sur 8, pas 1 sur 16",
    "KICK, piste 1 sur 8, pas 2 sur 16",
  ]);
  assert.deepEqual(attributes.filter(([name]) => name === "aria-pressed").map(([, value]) => value), ["false", "false"]);

  const sequencerClear = {
    window: { confirm: (message) => { sequencerClear.confirmation = message; return false; } },
    tracks: [],
  };
  runCapturedHandler(seq, '$("#clear").addEventListener("click", () => {', sequencerClear);
  assert.match(sequencerClear.confirmation, /visibles et masqués/);

  const track = { buffer: { id: "sample" }, hasStoredSample: true, fileName: "loop.wav" };
  let removals = 0;
  const removeScope = {
    track,
    window: { confirm: () => false },
    removeSample() { removals++; },
  };
  runCapturedHandler(seq, 'remove.addEventListener("click", () => {', removeScope);
  assert.equal(removals, 0);
  removeScope.window.confirm = () => true;
  removeScope.capturedHandler();
  assert.equal(removals, 1);
});
await test("The cutter canvas draws both its empty state and a selected waveform", async () => {
  const calls = [];
  const context = new Proxy({}, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => calls.push([name, ...args]);
    },
    set(target, name, value) { target[name] = value; return true; },
  });
  const scope = {
    window: { devicePixelRatio: 2 },
    canvas: { width: 800, height: 400 },
    g: context,
    buffer: null,
    draw(playhead) {},
  };
  bind(scope, fn(cut, "draw") + "globalThis.draw = draw;");
  scope.draw();
  assert.ok(calls.some(([name, text]) => name === "fillText" && /forme d’onde/.test(text)));
  calls.length = 0;
  scope.buffer = { duration: 10 };
  scope.duration = () => 10;
  scope.selectionStart = 2;
  scope.selectionEnd = 8;
  scope.waveBase = { id: "base" };
  scope.waveAccent = { id: "accent" };
  scope.draw(5);
  assert.equal(calls.filter(([name]) => name === "drawImage").length, 2);
  assert.ok(calls.some(([name]) => name === "clip"));
  assert.equal(calls.filter(([name]) => name === "stroke").length, 2);
});
function trackFixture() {
  const durationChecks = [];
  const scope = {
    core: {
      ...testCore,
      checkAudioFileDuration: async (blob, maxSeconds) => {
        durationChecks.push(maxSeconds);
        return 1;
      },
    },
    track: {
      id: "track-0",
      name: "Kick",
      load: core.latestOperation(),
      write: core.serialQueue(),
      importSequence: 0,
      committedImportSequence: 0,
      storageEpoch: 0,
      removing: false,
      _input: {},
      _label: { querySelector: () => null },
      buffer: { id: "previous" },
      fileName: "previous.wav",
    },
    status: { textContent: "" },
    persist: { textContent: "" },
    writes: [],
    stop() {},
    applyFx() {},
    updateLabel() {},
    saveState() {},
    ensureAudio: () => ({
      decodeAudioData: async (bytes) => ({ id: bytes.id }),
    }),
  };
  scope.dbPut = async (id, entry) => scope.writes.push(entry.name);
  scope.dbDelete = async () => scope.writes.push("delete");
  const fixture = bind(
    scope,
    fn(seq, "updateLabel") +
      "\n" +
      ["importSample", "removeSample", "restoreSample"]
        .map((n) => "async " + fn(seq, n))
        .join("\n"),
  );
  fixture.durationChecks = durationChecks;
  return fixture;
}
const file = (id, arrayBuffer = async () => ({ id })) => ({
  name: id + ".wav",
  size: 100,
  arrayBuffer,
});
await test("IndexedDB sample reads reject errors instead of masquerading as missing samples", async () => {
  const request = {};
  const db = {
    transaction() {
      return { objectStore: () => ({ get: () => request }) };
    },
  };
  const pending = vm.runInNewContext(
    "async " + fn(seq, "dbGet") + ";dbGet('track-0')",
    { openDB: async () => db, DB_STORE: "samples" },
  );
  await tick();
  request.error = Error("read failed");
  request.onerror();
  await assert.rejects(pending, /read failed/);
});
await test("A failed IndexedDB sample read keeps the possible record removable", async () => {
  const removeButton = { disabled: true };
  const label = {
    querySelector(selector) {
      return selector === ".remove-sample" ? removeButton : null;
    },
  };
  const track = {
    buffer: null,
    hasStoredSample: false,
    removing: false,
    _label: label,
  };
  const scope = {};
  bind(
    scope,
    fn(seq, "updateLabel") + "\n" +
      fn(seq, "markStoredSampleReadFailure") +
      "globalThis.markStoredSampleReadFailure = markStoredSampleReadFailure;",
  );
  scope.markStoredSampleReadFailure(track);
  assert.equal(track.hasStoredSample, true);
  assert.equal(track.fileName, "sample inaccessible");
  assert.equal(removeButton.disabled, false);
});
await test("IndexedDB open failures reject, clear the cached promise, and allow a retry", async () => {
  let requests = 0;
  const db = { close() {} };
  const fakeIndexedDB = {
    open() {
      const request = { error: Error("temporary open failure"), result: db };
      requests++;
      queueMicrotask(() => {
        if (requests === 1) request.onerror();
        else request.onsuccess();
      });
      return request;
    },
  };
  const scope = {
    window: { indexedDB: fakeIndexedDB },
    indexedDB: fakeIndexedDB,
  };
  bind(
    scope,
    `let dbPromise=null;const DB_NAME="test",DB_STORE="samples";${fn(seq, "openDB")};globalThis.openDB=openDB;`,
  );
  await assert.rejects(scope.openDB(), /temporary open failure/);
  assert.equal(await scope.openDB(), db);
  assert.equal(await scope.openDB(), db);
  assert.equal(requests, 2);
});
await test("A blocked IndexedDB open is reported and a late success is closed", async () => {
  let request;
  const scope = {
    window: { indexedDB: {} },
    indexedDB: {
      open() {
        request = { result: { closed: false, close() { this.closed = true; } } };
        return request;
      },
    },
  };
  bind(
    scope,
    `let dbPromise=null;const DB_NAME="test",DB_STORE="samples";${fn(seq, "openDB")};globalThis.openDB=openDB;`,
  );
  const pending = scope.openDB();
  request.onblocked();
  await assert.rejects(pending, /bloquée/);
  request.onsuccess();
  assert.equal(request.result.closed, true);
});
await test("The shared queue preserves write order and recovers after failure", async () => {
  const q = core.serialQueue(),
    first = deferred(),
    order = [];
  const a = q(async () => {
    order.push("A start");
    await first.promise;
    order.push("A end");
    throw Error("quota");
  });
  const rejected = assert.rejects(a, /quota/),
    b = q(() => order.push("B"));
  await tick();
  assert.deepEqual(order, ["A start"]);
  first.resolve();
  await rejected;
  await b;
  assert.deepEqual(order, ["A start", "A end", "B"]);
});
await test("The last import wins when file reading finishes out of order", async () => {
  const s = trackFixture(),
    a = deferred();
  const pending = s.importSample(
    s.track,
    file("A", () => a.promise),
  );
  await s.importSample(s.track, file("B"));
  a.resolve({ id: "A" });
  await pending;
  assert.equal(s.track.fileName, "B.wav");
  assert.deepEqual(s.writes, ["B.wav"]);
  assert.deepEqual(s.durationChecks, [undefined, undefined]);
});
await test("The last import wins when decoding finishes out of order", async () => {
  const s = trackFixture(),
    a = deferred();
  s.ensureAudio = () => ({
    decodeAudioData: (bytes) =>
      bytes.id === "A" ? a.promise : Promise.resolve({ id: bytes.id }),
  });
  const pending = s.importSample(s.track, file("A"));
  await tick();
  await s.importSample(s.track, file("B"));
  a.resolve({ id: "A" });
  await pending;
  assert.equal(s.track.buffer.id, "B");
  assert.deepEqual(s.writes, ["B.wav"]);
});
await test("A slow earlier storage write cannot become the final saved sample", async () => {
  const s = trackFixture(),
    saved = deferred();
  s.dbPut = async (id, entry) => {
    s.writes.push(entry.name);
    if (entry.name === "A.wav") await saved.promise;
  };
  const a = s.importSample(s.track, file("A"));
  await tick();
  const b = s.importSample(s.track, file("B"));
  await tick();
  assert.equal(s.track.fileName, "previous.wav");
  assert.deepEqual(s.writes, ["A.wav"]);
  saved.resolve();
  await Promise.all([a, b]);
  assert.equal(s.track.fileName, "B.wav");
  assert.deepEqual(s.writes, ["A.wav", "B.wav"]);
});
await test("A newer import that fails during an earlier write leaves memory and storage aligned", async () => {
  const s = trackFixture(),
    writeStarted = deferred(),
    finishWrite = deferred();
  let storedSample = "previous.wav";
  s.dbPut = async (id, entry) => {
    if (entry.name === "A.wav") {
      writeStarted.resolve();
      await finishWrite.promise;
    }
    storedSample = entry.name;
    s.writes.push(entry.name);
  };
  s.ensureAudio = () => ({
    decodeAudioData: async (bytes) => {
      if (bytes.id === "B") throw Error("decode failed");
      return { id: bytes.id };
    },
  });
  const first = s.importSample(s.track, file("A"));
  await writeStarted.promise;
  await s.importSample(s.track, file("B"));
  finishWrite.resolve();
  await first;
  assert.equal(storedSample, "A.wav");
  assert.equal(s.track.fileName, "A.wav");
  assert.equal(s.track.buffer.id, "A");
  assert.deepEqual(s.writes, ["A.wav"]);
});
await test("A queued valid import still completes when a newer import fails decoding", async () => {
  const s = trackFixture(),
    releaseQueue = deferred();
  s.ensureAudio = () => ({
    decodeAudioData: async (bytes) => {
      if (bytes.id === "B") throw Error("decode failed");
      return { id: bytes.id };
    },
  });
  const blocker = s.track.write(() => releaseQueue.promise);
  const first = s.importSample(s.track, file("A"));
  await tick();
  const newer = s.importSample(s.track, file("B", async () => ({ id: "B" })));
  await newer;
  assert.match(s.status.textContent, /decode failed/);
  releaseQueue.resolve();
  await blocker;
  await first;
  assert.equal(s.track.fileName, "A.wav");
  assert.equal(s.track.buffer.id, "A");
  assert.deepEqual(s.writes, ["A.wav"]);
  assert.match(s.status.textContent, /Import de B\.wav impossible/);
  assert.match(s.status.textContent, /A\.wav.*finalement été sauvegardé/);
  assert.doesNotMatch(s.status.textContent, /Le sample déjà sauvegardé est conservé/);
});
await test("A stale decode completion cannot overwrite a later successful import message", async () => {
  const s = trackFixture(),
    decodeA = deferred();
  s.ensureAudio = () => ({
    decodeAudioData: (bytes) =>
      bytes.id === "A" ? decodeA.promise : Promise.resolve({ id: bytes.id }),
  });
  const a = s.importSample(s.track, file("A"));
  await tick();
  await s.importSample(s.track, {
    ...file("B"),
    arrayBuffer: async () => { throw Error("B decode failed"); },
  });
  await s.importSample(s.track, file("C"));
  decodeA.resolve({ id: "A" });
  await a;
  assert.equal(s.track.fileName, "C.wav");
  assert.equal(s.track.buffer.id, "C");
  assert.equal(s.status.textContent, "Sample chargé et sauvegardé");
  assert.match(s.persist.textContent, /conservés automatiquement/);
  assert.deepEqual(s.writes, ["C.wav"]);
});
await test("A stale write failure cannot overwrite the newest import status", async () => {
  const s = trackFixture(),
    writeStarted = deferred(),
    finishA = deferred();
  s.dbPut = async (id, entry) => {
    if (entry.name === "A.wav") {
      writeStarted.resolve();
      await finishA.promise;
      throw Error("quota");
    }
    s.writes.push(entry.name);
  };
  const a = s.importSample(s.track, file("A"));
  await writeStarted.promise;
  await s.importSample(s.track, {
    ...file("B"),
    arrayBuffer: async () => { throw Error("B decode failed"); },
  });
  const c = s.importSample(s.track, file("C"));
  await tick();
  finishA.resolve();
  await Promise.all([a, c]);
  assert.equal(s.track.fileName, "C.wav");
  assert.equal(s.track.buffer.id, "C");
  assert.equal(s.status.textContent, "Sample chargé et sauvegardé");
  assert.match(s.persist.textContent, /conservés automatiquement/);
  assert.deepEqual(s.writes, ["C.wav"]);
});
await test("A failed sample write preserves the previous in-memory sample", async () => {
  const s = trackFixture();
  s.dbPut = async () => {
    throw Error("quota");
  };
  await s.importSample(s.track, file("new"));
  assert.equal(s.track.fileName, "previous.wav");
  assert.equal(s.track.buffer.id, "previous");
  assert.match(s.status.textContent, /précédent est conservé/);
  assert.match(s.persist.textContent, /précédent est conservé/);
});
await test("Restoration cannot overwrite an import selected during startup", async () => {
  const s = trackFixture(),
    a = deferred();
  s.ensureAudio = () => ({
    decodeAudioData: (bytes) =>
      bytes.id === "stored" ? a.promise : Promise.resolve({ id: bytes.id }),
  });
  const restore = s.restoreSample(
    s.track,
    { name: "stored.wav", blob: file("stored") },
    s.track.load.version(),
  );
  await tick();
  await s.importSample(s.track, file("B"));
  a.resolve({ id: "stored" });
  assert.equal(await restore, false);
  assert.equal(s.track.fileName, "B.wav");
});
await test("A sample rejected by the duration limit remains removable", async () => {
  const s = trackFixture();
  s.core = {
    ...testCore,
    checkAudioFileDuration: async () => {
      throw Error("Ce fichier dure 150 s. La limite est de 2 minutes.");
    },
  };
  const restored = await s.restoreSample(
    s.track,
    { name: "long.wav", blob: file("long") },
    s.track.load.version(),
  );
  assert.equal(restored, false);
  assert.equal(s.track.hasStoredSample, true);
  assert.match(s.track.fileName, /impossible à restaurer/);
  const removeButton = { disabled: true };
  s.track._label = {
    querySelector(selector) {
      return selector === ".remove-sample" ? removeButton : null;
    },
  };
  s.updateLabel(s.track, s.track._label);
  assert.equal(removeButton.disabled, false);
});
await test("Removing a sample cancels a pending import and waits for earlier writes", async () => {
  const s = trackFixture(),
    a = deferred();
  const pending = s.importSample(
    s.track,
    file("A", () => a.promise),
  );
  await s.removeSample(s.track);
  a.resolve({ id: "A" });
  await pending;
  assert.equal(s.track.buffer, null);
  assert.deepEqual(s.writes, ["delete"]);
  assert.equal(s.track._input.disabled, false);
});
await test("Failed removal retains the sample and unlocks its input", async () => {
  const s = trackFixture();
  s.dbDelete = async () => {
    throw Error("quota");
  };
  await s.removeSample(s.track);
  assert.equal(s.track.buffer.id, "previous");
  assert.equal(s.track._input.disabled, false);
  assert.match(s.status.textContent, /non supprimé/);
});
await test("A failed removal does not invalidate an import that is still decoding", async () => {
  const s = trackFixture(),
    decoded = deferred();
  s.core.checkAudioFileDuration = async () => decoded.promise;
  s.dbDelete = async () => { throw Error("quota"); };
  const pendingImport = s.importSample(s.track, file("new"));
  await tick();
  await s.removeSample(s.track);
  assert.match(s.persist.textContent, /imports déjà en cours peuvent se terminer/);
  decoded.resolve(1);
  await pendingImport;
  assert.equal(s.track.fileName, "new.wav");
  assert.equal(s.track.buffer.id, "new");
  assert.deepEqual(s.writes, ["new.wav"]);
});
await test("Sequencer master output is connected through the compressor", async () => {
  let connectedTo = null,
    destination = null;
  const input = { connect(node) { connectedTo = node; return node; } };
  const limiter = {
    threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
    connect(node) { destination = node; return this; },
  };
  const context = {
    destination: {},
    createDynamicsCompressor: () => limiter,
  };
  const helper = fn(seq, "connectMasterLimiter");
  const result = vm.runInNewContext(
    helper + ";connectMasterLimiter(context,input);",
    { context, input },
  );
  assert.equal(result, limiter);
  assert.equal(connectedTo, limiter);
  assert.equal(destination, context.destination);
  assert.equal(limiter.threshold.value, -1);
  assert.equal(limiter.ratio.value, 20);
});
await test("Industrial clap uses the synthesized voice when its sample is absent", async () => {
  const hits = [];
  const scope = {
    tracks: [{ id: "clap", steps: [true] }],
    audible: () => true,
    kit: { value: "industrial" },
    industrialClapBuffer: null,
    industrialClap: () => hits.push("sample"),
    classic808Clap: () => hits.push("fallback"),
    noiseHit() {},
    ctx: { currentTime: 0 },
    setTimeout: () => 1,
    paintTimers: new Set(),
    cells: [[]],
    playing: false,
  };
  vm.runInNewContext(fn(source("index"), "schedule") + ";schedule(0,0.1);", scope);
  assert.deepEqual(hits, ["fallback"]);
});
await test("Industrial clap download aborts at its deadline", async () => {
  let onTimeout, delay, aborted = 0, cleared = 0, requestOptions;
  class AbortControllerProbe {
    constructor() { this.signal = {}; }
    abort() { aborted++; }
  }
  const scope = {
    AbortController: AbortControllerProbe,
    INDUSTRIAL_CLAP_TIMEOUT_MS: 8000,
    setTimeout(callback, ms) { onTimeout = callback; delay = ms; return 7; },
    clearTimeout(id) { if (id === 7) cleared++; },
    fetch(url, options) {
      assert.equal(url, "./industrial-clap.wav");
      requestOptions = options;
      return new Promise(() => {});
    },
  };
  const pending = vm.runInNewContext(
    fn(drums, "fetchWithTimeout") + ";fetchWithTimeout('./industrial-clap.wav')",
    scope,
  );
  await tick();
  assert.equal(delay, 8000);
  onTimeout();
  await assert.rejects(pending, /délai maximal/);
  assert.ok(requestOptions.signal);
  assert.equal(aborted, 1);
  assert.equal(cleared, 1);
});
await test("Industrial clap timeout includes a stalled response body", async () => {
  let onTimeout, aborted = 0, bodyRead = false;
  class AbortControllerProbe {
    constructor() { this.signal = {}; }
    abort() { aborted++; }
  }
  const scope = {
    AbortController: AbortControllerProbe,
    INDUSTRIAL_CLAP_TIMEOUT_MS: 8000,
    setTimeout(callback) { onTimeout = callback; return 9; },
    clearTimeout() {},
    fetch: async () => ({
      ok: true,
      arrayBuffer() { bodyRead = true; return new Promise(() => {}); },
    }),
    ctx: { decodeAudioData() { throw Error("decode should not start"); } },
  };
  const pending = vm.runInNewContext(
    fn(drums, "fetchWithTimeout") + ";fetchWithTimeout('./industrial-clap.wav')",
    scope,
  );
  await tick();
  assert.equal(bodyRead, true);
  onTimeout();
  await assert.rejects(pending, /délai maximal/);
  assert.equal(aborted, 1);
});
await test("Industrial clap timeout includes audio decoding", async () => {
  let onTimeout, decodeStarted = false, aborted = 0;
  class AbortControllerProbe {
    constructor() { this.signal = {}; }
    abort() { aborted++; }
  }
  const scope = {
    AbortController: AbortControllerProbe,
    INDUSTRIAL_CLAP_TIMEOUT_MS: 8000,
    setTimeout(callback) { onTimeout = callback; return 10; },
    clearTimeout() {},
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    ctx: { decodeAudioData() { decodeStarted = true; return new Promise(() => {}); } },
  };
  const pending = vm.runInNewContext(
    fn(drums, "fetchWithTimeout") + ";fetchWithTimeout('./industrial-clap.wav')",
    scope,
  );
  await tick();
  assert.equal(decodeStarted, true);
  onTimeout();
  await assert.rejects(pending, /délai maximal/);
  assert.equal(aborted, 1);
});
await test("A failed industrial clap load can be retried on a later start", async () => {
  let requests = 0;
  const scope = {
    industrialClapBuffer: null,
    industrialClapBufferPromise: null,
    fetchWithTimeout() { requests++; return Promise.reject(new Error("offline")); },
    console: { warn() {} },
  };
  bind(scope, "async " + fn(drums, "loadIndustrialClap") + ";");
  assert.equal(await scope.loadIndustrialClap(), null);
  assert.equal(await scope.loadIndustrialClap(), null);
  assert.equal(requests, 2);
});
await test("The 808 clap frequency used by the synth matches the tuning display", async () => {
  const frequencies = [];
  const node = () => ({
    gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    frequency: { setValueAtTime(value) { frequencies.push(value); } },
    Q: { setValueAtTime() {} },
    connect(next) { return next; },
    start() {},
    stop() {},
  });
  const scope = {
    kit: { value: "808" },
    activeSources: new Set(),
    ctx: { createBufferSource: node, createBiquadFilter: node, createGain: node },
    noiseBuffer: () => ({}),
    voiceOutput: () => node(),
    getClapRoom: () => node(),
  };
  bind(
    scope,
    fn(drums, "trackSource") + fn(drums, "tuningReference") + fn(drums, "classic808Clap") +
      ";classic808Clap(1,{id:'clap',tuning:0});",
  );
  assert.equal(scope.tuningReference("clap"), 1700);
  assert.ok(frequencies.length > 0);
  assert.ok(frequencies.every((frequency) => frequency === 1700));
  assert.doesNotMatch(drums, /else if \(kind === "clap"\)/);
  assert.doesNotMatch(drums, /industrial \? 0\.2 : 0\.2/);
});
await test("808 tempo and tuning persistence is debounced and flushed on commit", async () => {
  const callbacks = new Map();
  let nextTimer = 0,
    writes = 0,
    cleared = 0;
  const scope = {
    patternSaveTimer: 0,
    savePattern() { writes++; },
    setTimeout(callback, delay) {
      assert.equal(delay, 180);
      const id = ++nextTimer;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      if (callbacks.delete(id)) cleared++;
    },
  };
  bind(scope, fn(drums, "schedulePatternSave") + fn(drums, "flushPatternSave"));
  scope.schedulePatternSave();
  scope.schedulePatternSave();
  assert.equal(writes, 0);
  assert.equal(callbacks.size, 1);
  assert.equal(cleared, 1);
  const [timer, callback] = [...callbacks.entries()][0];
  callbacks.delete(timer);
  callback();
  assert.equal(writes, 1);
  scope.schedulePatternSave();
  scope.flushPatternSave();
  assert.equal(writes, 2);
  assert.equal(callbacks.size, 0);
});
await test("Stopping the 808 fades the transport bus to silence", async () => {
  const automation = [];
  const stoppedAt = [];
  const gain = {
    value: 1,
    cancelScheduledValues(time) { automation.push(["cancel", time]); },
    setValueAtTime(value, time) { automation.push(["set", value, time]); this.value = value; },
    linearRampToValueAtTime(value, time) { automation.push(["ramp", value, time]); },
  };
  const scope = {
    ctx: { currentTime: 2, state: "running" },
    transportGain: { gain },
    startVersion: 0,
    starting: false,
    playing: true,
    playButton: { disabled: false, textContent: "■ Arrêter" },
    timer: 7,
    activeSources: new Set([{ stop: (time) => stoppedAt.push(time) }]),
    paintTimers: new Set(),
    cells: [],
    status: { textContent: "En lecture" },
    clearInterval(id) { assert.equal(id, 7); },
    setTimeout() {},
    clearTimeout() {},
  };
  bind(scope, fn(drums, "setTransportGain") + fn(drums, "stop") + ";stop();");
  assert.equal(scope.playing, false);
  assert.ok(automation.some((entry) => entry[0] === "ramp" && entry[1] === 0 && entry[2] === 2.005));
  assert.deepEqual(stoppedAt, [2.006]);
  assert.equal(scope.activeSources.size, 0);
});
await test("808 tom synthesis safely skips a missing voice track", async () => {
  vm.runInNewContext(
    "const tracks=[];" + fn(drums, "tom") + ";tom(0,false);",
  );
});
await test("The 808 reuses its clap reverb node and looks up voices by ID", async () => {
  let convolvers = 0, gains = 0;
  const scope = {
    ctx: {
      createConvolver() { convolvers++; return { connect(next) { return next; }, buffer: null }; },
      createGain() { gains++; return { gain: { value: 0 }, connect(next) { return next; } }; },
    },
    clapRoomNode: null, clapRoomWet: null,
    clapImpulseResponse: () => ({ id: "impulse" }),
    voiceOutput: () => ({}),
  };
  bind(scope, fn(drums, "getClapRoom") + ";const first=getClapRoom();const second=getClapRoom();first===second;");
  assert.equal(convolvers, 1);
  assert.equal(gains, 1);
  assert.doesNotMatch(drums, /tracks\[(?:0|7)\]\.tuning/);
  assert.match(drums, /aria-describedby", tuneOutput\.id/);
});
await test("808 playback starts with its synthesized clap when loading times out", async () => {
  const audio = { currentTime: 4, resume: async () => {} };
  const playButton = { disabled: false, textContent: "▶ Jouer" };
  const scope = {
    playing: false, starting: false, startVersion: 0,
    playButton, kit: { value: "industrial" }, industrialClapBuffer: null,
    status: { textContent: "" },
    ensureAudio: () => audio,
    setTransportGain(value) { scope.transportLevels.push(value); },
    loadIndustrialClap: async () => null,
    ctx: audio, step: 0, nextTime: 0, timer: null, interval: 25,
    transportLevels: [],
    scheduler() {}, setInterval: () => 12,
  };
  await vm.runInNewContext("async " + fn(drums, "start") + ";start()", scope);
  assert.equal(scope.playing, true);
  assert.equal(scope.starting, false);
  assert.equal(playButton.disabled, false);
  assert.equal(playButton.textContent, "■ Arrêter");
  assert.match(scope.status.textContent, /clap synthétique de secours/);
  assert.deepEqual(scope.transportLevels, [1]);
});
await test("Groove scores restore valid values and default safely on corrupt storage", async () => {
  const grooveSource = source("groove-mystere");
  const read = fn(grooveSource, "readScores");
  const restored = vm.runInNewContext(
    'const SCORE_KEY="scores";' + read +
      ';JSON.stringify(readScores());',
    {
      localStorage: {
        getItem: () => JSON.stringify({ bestByMode: { drums: 8.9, notes: -2 } }),
      },
      persistenceStatus: { hidden: true, textContent: "" },
    },
  );
  assert.deepEqual(JSON.parse(restored), {
    bestByMode: { drums: 8, notes: 0 },
    bestPatternsByMode: { drums: 0, notes: 0 },
  });
  const readFailure = { hidden: true, textContent: "" };
  const corrupt = vm.runInNewContext(
    'const SCORE_KEY="scores";' + read + ';JSON.stringify(readScores());',
    {
      localStorage: { getItem: () => { throw Error("storage denied"); } },
      persistenceStatus: readFailure,
    },
  );
  assert.deepEqual(JSON.parse(corrupt).bestByMode, { drums: 0, notes: 0 });
  assert.equal(readFailure.hidden, false);
  assert.match(readFailure.textContent, /n’a pas pu être lu/);
  let persisted = "";
  const save = fn(grooveSource, "saveScores");
  vm.runInNewContext(
    'const SCORE_KEY="scores";' + save + ";saveScores();",
    {
      bestByMode: { drums: 3, notes: 1 },
      bestPatternsByMode: { drums: 2, notes: 0 },
      persistenceStatus: { hidden: false, textContent: "" },
      localStorage: { setItem: (key, value) => (persisted = key + ":" + value) },
      updateStatus() {},
    },
  );
  assert.match(persisted, /^scores:/);
  assert.equal(JSON.parse(persisted.slice(persisted.indexOf(":") + 1)).bestByMode.drums, 3);
});
await test("Groove score-save errors stay visible beside later gameplay messages", async () => {
  const status = { hidden: true, textContent: "" };
  const save = fn(source("groove-mystere"), "saveScores");
  const saved = vm.runInNewContext(
    'const SCORE_KEY="scores";' + save + ";saveScores();",
    {
      bestByMode: { drums: 4, notes: 0 },
      bestPatternsByMode: { drums: 0, notes: 0 },
      persistenceStatus: status,
      localStorage: { setItem() { throw Error("storage denied"); } },
    },
  );
  let gameMessage = "Bien joué ! Le groove s'allonge…";
  assert.equal(saved, false);
  assert.equal(gameMessage, "Bien joué ! Le groove s'allonge…");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Meilleur score conservé pour cette session/);
  const html = fs.readFileSync(path.join(root, "groove-mystere.html"), "utf8");
  assert.match(html, /id="persist"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  gameMessage = "Motif retrouvé ! Un nouveau motif arrive…";
  assert.match(status.textContent, /enregistrement/);
});
await test("Groove instructions and pad names follow the selected modes", async () => {
  const padNames = ["Grosse caisse", "Caisse claire", "Charleston", "Clap"];
  const aria = ["Grosse caisse", "Caisse claire", "Charleston", "Clap"];
  const pads = Array.from({ length: 4 }, () => {
    const children = { ".glyph": { textContent: "" }, ".name": { textContent: "" } };
    return {
      querySelector: (selector) => children[selector],
      children,
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    };
  });
  const makeButtons = (modes) => modes.map((mode) => ({
    dataset: { mode }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  }));
  const padsGroup = { setAttribute(name, value) { this[name] = value; } };
  const scope = {
    pads,
    padSets: {
      drums: padNames.map((name, i) => ({ name, glyph: "D" + i, aria: aria[i] })),
      notes: ["Sol grave", "Do", "Mi", "Sol aigu"].map((name, i) => ({ name, glyph: "N" + i, aria: "Note " + name })),
    },
    soundModeButtons: makeButtons(["drums", "notes"]),
    gameModeButtons: makeButtons(["simon", "pattern"]),
    mode: "notes", gameMode: "pattern",
    gameModeTitle: { textContent: "" }, howto: { textContent: "" },
    updateRoundLabel() {},
    document: { querySelector: () => padsGroup },
  };
  const render = fn(source("groove-mystere"), "renderMode");
  vm.runInNewContext(render + ";renderMode()", scope);
  assert.deepEqual(pads.map((pad) => pad.children[".name"].textContent), ["Sol grave", "Do", "Mi", "Sol aigu"]);
  assert.deepEqual(pads.map((pad) => pad.attributes["aria-label"]), [
    "Note Sol grave · raccourci clavier 1", "Note Do · raccourci clavier 2",
    "Note Mi · raccourci clavier 3", "Note Sol aigu · raccourci clavier 4",
  ]);
  assert.equal(scope.gameModeTitle.textContent, "Motif mystère");
  assert.match(scope.howto.textContent, /nouveau motif de 4 notes/);
  scope.gameMode = "simon";
  vm.runInNewContext("renderMode()", scope);
  assert.equal(scope.gameModeTitle.textContent, "Séquence musicale");
  assert.match(scope.howto.textContent, /Chaque tour ajoute une note/);
  const html = fs.readFileSync(path.join(root, "groove-mystere.html"), "utf8");
  assert.match(html, /clique sur « Lancer la partie »/);
  assert.match(html, /Clique sur « Lancer la partie » pour démarrer le son/);
  assert.doesNotMatch(html, /bouton de lecture de l’atelier/);
});
await test("Groove stops when the tab is hidden or its active audio context is interrupted", async () => {
  const gameText = source("groove-mystere");
  const hiddenMessages = [];
  const hiddenScope = {
    document: { hidden: true },
    stopForInterruption(message) { hiddenMessages.push(message); },
  };
  runCapturedHandler(
    gameText,
    'document.addEventListener("visibilitychange", () => {',
    hiddenScope,
  );
  assert.match(hiddenMessages[0], /arrière-plan/);

  let onStateChange;
  const context = {
    state: "running",
    addEventListener(name, callback) { if (name === "statechange") onStateChange = callback; },
  };
  let interruptionMessage = "";
  const interruptedScope = {
    audioContext: context,
    monitoredAudioContext: null,
    audioContextHasRun: false,
    phase: "input",
    stopForInterruption(message) { interruptionMessage = message; },
  };
  vm.runInNewContext(fn(gameText, "watchAudioContext") + ";watchAudioContext(audioContext)", interruptedScope);
  context.state = "suspended";
  onStateChange();
  assert.match(interruptionMessage, /interruption audio/);
});
await test("Groove stops the active game when audio resume rejects", async () => {
  let stoppedMessage = "";
  const scope = {
    audioContext: {
      state: "suspended",
      resume() { return Promise.reject(new Error("resume denied")); },
    },
    session: { version: () => 4, current: (token) => token === 4 },
    watchAudioContext() {},
    hasActiveGame: () => true,
    stopForInterruption(message) { stoppedMessage = message; },
    updateStatus(message) { stoppedMessage = message; },
    scheduleSound() { assert.fail("must not schedule after rejected resume"); },
  };
  vm.runInNewContext(fn(source("groove-mystere"), "makeSound") + ";makeSound(0, 4)", scope);
  await tick();
  assert.match(stoppedMessage, /Partie arrêtée/);
  assert.match(stoppedMessage, /réactiver le son/);
});
await test("Groove reports a resume that resolves without a running audio context", async () => {
  let stoppedMessage = "";
  const scope = {
    audioContext: {
      state: "suspended",
      resume: () => Promise.resolve(),
    },
    session: { version: () => 4, current: (token) => token === 4 },
    watchAudioContext() {},
    hasActiveGame: () => true,
    stopForInterruption(message) { stoppedMessage = message; },
    updateStatus(message) { stoppedMessage = message; },
    scheduleSound() { assert.fail("must not schedule while audio is suspended"); },
  };
  vm.runInNewContext(fn(source("groove-mystere"), "makeSound") + ";makeSound(0, 4)", scope);
  await tick();
  assert.match(stoppedMessage, /Partie arrêtée/);
  assert.match(stoppedMessage, /réactiver le son/);
});
await test("Groove number keys activate pads without taking over text fields", async () => {
  const src = source("groove-mystere");
  const at = src.lastIndexOf('document.addEventListener("keydown", (event) => {');
  const handler = block(src, src.indexOf("{", at));
  const pressed = [];
  class ElementProbe {
    constructor(editable = false) { this.editable = editable; }
    closest() { return this.editable ? {} : null; }
  }
  const scope = {
    Element: ElementProbe,
    pads: Array.from({ length: 4 }, (_, id) => ({
      disabled: false,
      click() { pressed.push(id); },
    })),
  };
  const keydown = vm.runInNewContext("event=>{" + handler + "}", scope);
  let prevented = false;
  keydown({ key: "3", target: {}, preventDefault() { prevented = true; } });
  assert.deepEqual(pressed, [2]);
  assert.equal(prevented, true);
  keydown({ key: "1", target: new ElementProbe(true), preventDefault() {} });
  assert.deepEqual(pressed, [2]);
  scope.pads[1].disabled = true;
  keydown({ key: "2", target: {}, preventDefault() {} });
  assert.deepEqual(pressed, [2]);
});
await test("Keyboard waveform boundary edits preserve the minimum selection", async () => {
  const scope = {
    buffer: {},
    selectionStart: 0.5,
    selectionEnd: 1,
    duration: () => 2,
    setSelection: null,
    timeText: (value) => value.toFixed(3),
    position: { textContent: "" },
    message: { textContent: "" },
  };
  scope.setSelection = (a, b) => {
    scope.selectionStart = Math.min(a, b);
    scope.selectionEnd = Math.max(a, b);
  };
  vm.runInNewContext(fn(cut, "adjustSelectionBoundary") + ";adjustSelectionBoundary('end',-4);", scope);
  assert.ok(scope.selectionEnd - scope.selectionStart >= 0.005);
  vm.runInNewContext("adjustSelectionBoundary('start',-2);", scope);
  assert.equal(scope.selectionStart, 0);
  assert.match(scope.message.textContent, /Sélection clavier/);
});
await test("Effects rendering can stop at a scheduled offline checkpoint", async () => {
  const checkpoint = deferred();
  const render = deferred();
  let resumeCalls = 0,
    renderSettled = false;
  render.promise.then(() => { renderSettled = true; });
  const context = {
    length: 48000 * 3,
    sampleRate: 48000,
    suspend() { return checkpoint.promise; },
    resume() {
      resumeCalls++;
      render.resolve({ id: "discarded" });
      return Promise.resolve();
    },
    startRendering() { return render.promise; },
  };
  const operation = { cancelled: false };
  let capability = false;
  const task = vm.runInNewContext(
    block(source("effects"), source("effects").indexOf("async function renderOfflineCancellable")) +
      ";renderOfflineCancellable(context,operation,value=>capability=value);",
    { context, operation, capability },
  );
  await tick();
  assert.equal(context.length / context.sampleRate, 3);
  operation.cancelled = true;
  checkpoint.resolve();
  const outcome = await task;
  assert.equal(outcome.cancelled, true);
  await render.promise;
  assert.equal(resumeCalls, 1);
  assert.equal(renderSettled, true);
});
await test("Effects render reports when its browser cannot cancel offline work", async () => {
  const context = {
    length: 48000,
    sampleRate: 48000,
    startRendering: async () => ({ id: "rendered" }),
  };
  const capabilities = [];
  const result = await vm.runInNewContext(
    block(source("effects"), source("effects").indexOf("async function renderOfflineCancellable")) +
      ";renderOfflineCancellable(context,operation,(value,reason)=>capabilities.push([value,reason]));",
    { context, operation: { cancelled: false }, capabilities },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(capabilities)), [[false, "unsupported"]]);
  assert.equal(result.buffer.id, "rendered");
});
await test("Effects sliders associate their outputs and expose formatted accessible values", async () => {
  const html = fs.readFileSync(path.join(root, "effects.html"), "utf8");
  for (const [id, text] of [
    ["cut", "18 kHz"],
    ["drive", "0%"],
    ["delay", "0%"],
    ["reverb", "0%"],
  ]) {
    const input = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(input, `${id} input exists`);
    assert.match(input, new RegExp(`aria-describedby="${id}v"`));
    assert.match(html, new RegExp(`<output[^>]*id="${id}v"[^>]*for="${id}"`));
    const output = { textContent: "" };
    const control = {
      id,
      value: id === "cut" ? "18000" : "0",
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    };
    bind(
      { control, $: () => output, formatters: {
        cut: () => "18 kHz",
        drive: (value) => value + "%",
        delay: (value) => value + "%",
        reverb: (value) => value + "%",
      } },
      fn(source("effects"), "updateControlValue") + ";updateControlValue(control);",
    );
    assert.equal(output.textContent, text);
    assert.equal(control.attributes["aria-valuetext"], text);
  }
});
await test("Effects control output is optional and compressor settings are shared", async () => {
  const control = {
    id: "cut",
    value: "18000",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  bind(
    { control, $: () => null, formatters: { cut: () => "18 kHz" } },
    fn(source("effects"), "updateControlValue") + ";updateControlValue(control);",
  );
  assert.equal(control.attributes["aria-valuetext"], "18 kHz");
  const compressor = {
    threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
    attack: { value: 0 }, release: { value: 0 },
  };
  const created = vm.runInNewContext(
    fn(source("effects"), "makeOutputCompressor") + ";makeOutputCompressor(context);",
    { context: { createDynamicsCompressor: () => compressor } },
  );
  assert.equal(created.threshold.value, -1);
  assert.equal(created.ratio.value, 20);
  assert.equal(created.attack.value, 0.003);
  assert.equal(created.release.value, 0.12);
});
await test("Effects settings reject non-numeric values and saturation curves are cached", async () => {
  const elements = new Map([
    ["#cut", { value: "not-a-number", min: "500", max: "18000" }],
    ["#drive", { value: "150", min: "0", max: "100" }],
    ["#delay", { value: "", min: "0", max: "70" }],
  ]);
  const scope = bind(
    { $: (selector) => elements.get(selector) || null },
    `const driveCurves=new Map();${fn(source("effects"), "readControlValue")}${fn(source("effects"), "readSettings")}${fn(source("effects"), "makeDriveCurve")};globalThis.settings=readSettings();globalThis.first=makeDriveCurve(.3);globalThis.second=makeDriveCurve(.3);`,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(scope.settings)), {
    cut: 18000, drive: 1, delay: 0, reverb: 0,
  });
  assert.equal(scope.first, scope.second);
  assert.equal(scope.first.length, 8192);
  assert.ok([...scope.first].every(Number.isFinite));
});
await test("The cutter revokes a test-tone URL when playback is rejected", async () => {
  const revoked = [];
  class AudioProbe {
    constructor(url) { this.url = url; }
    async play() { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); }
  }
  const scope = {
    stop() {}, makeTestTone: () => new Blob(["tone"]), gainInput: { value: "70" },
    message: { textContent: "" }, Audio: AudioProbe,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: (url) => revoked.push(url) },
  };
  bind(scope, "async " + fn(cut, "testOutput") + ";testOutput()");
  await tick();
  await tick();
  assert.deepEqual(revoked, ["blob:test"]);
  assert.match(scope.message.textContent, /Le navigateur a refusé/);
});
await test("The cutter debounces waveform resizing and reports discarded channels", async () => {
  const timers = new Map();
  let nextId = 0, fits = 0, clears = 0;
  const scope = {
    resizeTimer: 0,
    fitCanvas() { fits++; },
    window: {
      clearTimeout(id) { if (timers.delete(id)) clears++; },
      setTimeout(callback, delay) { assert.equal(delay, 120); timers.set(++nextId, callback); return nextId; },
    },
  };
  bind(scope, fn(cut, "scheduleCanvasFit") + ";scheduleCanvasFit();scheduleCanvasFit();scheduleCanvasFit();");
  assert.equal(clears, 2);
  assert.equal(timers.size, 1);
  timers.values().next().value();
  assert.equal(fits, 1);
  assert.match(vm.runInNewContext(fn(cut, "exportChannelNote") + ";exportChannelNote(4);"), /seuls les deux premiers/);
  assert.equal(vm.runInNewContext(fn(cut, "exportChannelNote") + ";exportChannelNote(2);"), "");
});
await test("The cutter refreshes the playhead when audio pauses before selection end", async () => {
  const draws = [], scope = {
    selectionStart: 0, selectionEnd: 8,
    media: { currentTime: 3.25 },
    position: { textContent: "" },
    timeText: (value) => value.toFixed(2),
    draw: (value) => draws.push(value),
  };
  vm.runInNewContext(fn(cut, "updatePausedPosition") + ";updatePausedPosition();", scope);
  assert.equal(scope.position.textContent, "3.25");
  assert.deepEqual(draws, [3.25]);
});
await test("Groove Mystere routes every synthesized voice through one master limiter", async () => {
  const edges = [];
  const audioParam = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
  });
  const makeNode = (name) => ({
    name,
    connect(next) { edges.push([this, next]); return next; },
    start() {},
    stop() {},
    frequency: audioParam(),
    gain: audioParam(),
    Q: audioParam(),
    threshold: audioParam(),
    knee: audioParam(),
    ratio: audioParam(),
    attack: audioParam(),
    release: audioParam(),
  });
  const destination = { name: "destination" };
  const context = {
    currentTime: 1,
    sampleRate: 44100,
    destination,
    createDynamicsCompressor: () => makeNode("limiter"),
    createOscillator: () => makeNode("oscillator"),
    createBufferSource: () => makeNode("source"),
    createBiquadFilter: () => makeNode("filter"),
    createGain: () => makeNode("gain"),
    createBuffer: (_channels, length) => ({
      getChannelData: () => new Float32Array(length),
    }),
  };
  const scope = {
    context,
    noiseBuffers: new WeakMap(),
    limiterContext: undefined,
    masterLimiter: undefined,
    mode: "drums",
    noteFrequencies: [196, 261.63, 329.63, 392],
    trackSound: (node) => node,
  };
  bind(
    scope,
    fn(game, "noiseBufferFor") + fn(game, "getMasterLimiter") + fn(game, "scheduleSound") +
      ";for(let id=0;id<4;id++)scheduleSound(id,context);mode='notes';for(let id=0;id<4;id++)scheduleSound(id,context);",
  );
  const limiter = scope.masterLimiter;
  assert.equal(limiter.threshold.value, -1);
  assert.equal(limiter.knee.value, 0);
  assert.equal(limiter.ratio.value, 20);
  assert.equal(limiter.attack.value, 0.003);
  assert.equal(limiter.release.value, 0.12);
  assert.deepEqual(edges.filter(([, target]) => target === destination), [[limiter, destination]]);
  assert.ok(edges.some(([, target]) => target === limiter));
});
await test("Groove notes are scheduled against the Web Audio clock", async () => {
  const starts = [], stops = [], destination = {};
  const param = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
  });
  const node = () => ({
    frequency: param(), gain: param(), Q: param(),
    connect(next) { return next; },
    start(time) { starts.push(time); },
    stop(time) { stops.push(time); },
  });
  const context = {
    currentTime: 2,
    createOscillator: node,
    createBiquadFilter: node,
    createGain: node,
  };
  vm.runInNewContext(
    fn(game, "scheduleSound") + ";scheduleSound(0,context,2.5);",
    { mode: "notes", noteFrequencies: [440], getMasterLimiter: () => destination, trackSound: (value) => value, context },
  );
  assert.deepEqual(starts, [2.5]);
  assert.deepEqual(stops, [2.85]);
  assert.match(fn(game, "playSequence"), /ctx\.currentTime/);
  assert.match(fn(game, "playSequence"), /sequence\.forEach/);
  assert.doesNotMatch(game, /event\.detail\s*===\s*0/);
  assert.match(game, /startButton\.addEventListener\("pointerdown"/);
});
await test("Groove Mystere skips pad flashes when reduced motion is requested", async () => {
  for (const reduce of [true, false]) {
    const changes = [],
      sounds = [],
      pad = { classList: {
        add: (name) => changes.push("add " + name),
        remove: (name) => changes.push("remove " + name),
      } };
    const scope = {
      window: { matchMedia: () => ({ matches: reduce }) },
      session: { version: () => 1, current: () => true },
      audioContext: { currentTime: 0 },
      pads: [pad],
      flashVersions: [0],
      wait: async () => {},
      makeSound: (id) => { sounds.push(id); return Promise.resolve(0); },
    };
    bind(scope, fn(game, "prefersReducedMotion") + "async " + fn(game, "flash") + ";flash(0);");
    await tick();
    assert.deepEqual(changes, reduce ? [] : ["add is-lit", "remove is-lit"]);
    assert.deepEqual(sounds, [0]);
  }
});
await test("Oversized files are refused before reading or decoding", async () => {
  core.checkAudioFile({ size: 50_000_000 });
  assert.throws(() => core.checkAudioFile({ size: 50_000_001 }), /50 Mo/);
  const s = trackFixture(),
    pendingRead = deferred();
  const earlier = s.importSample(s.track, file("A", () => pendingRead.promise));
  await tick();
  await s.importSample(s.track, {
    name: "B.wav",
    size: 50_000_001,
    arrayBuffer() {
      throw Error("must not read");
    },
  });
  pendingRead.resolve({ id: "A" });
  await earlier;
  assert.equal(s.track.fileName, "previous.wav");
  assert.equal(s.track.load.version(), 2);
  assert.deepEqual(s.writes, []);
  assert.match(s.status.textContent, /50 Mo/);
  assert.match(s.status.textContent, /Import de B\.wav impossible/);
  assert.doesNotMatch(s.status.textContent, /A\.wav a été annulé/);
});
function transportFixture() {
  const resume = deferred(),
    timers = new Set();
  let id = 0;
  const s = {
    transport: core.latestOperation(),
    starting: false,
    playing: false,
    schedulerId: 0,
    step: 0,
    nextTime: 0,
    tracks: [{ buffer: {} }],
    status: {},
    play: {},
    ensureAudio: () => ({ resume: () => resume.promise, currentTime: 0 }),
    scheduler() {},
    setInterval: () => {
      timers.add(++id);
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    activeSources: new Set(),
    paintTimers: new Set(),
    clearTimeout() {},
    cells: [],
  };
  bind(s, "async " + fn(seq, "start") + "\n" + fn(seq, "stop"));
  return { s, resume, timers };
}
await test("Two starts while audio resumes create one interval; stop cancels it", async () => {
  const { s, resume, timers } = transportFixture();
  const a = s.start(),
    b = s.start();
  assert.equal(s.play.disabled, true);
  resume.resolve();
  await Promise.all([a, b]);
  assert.equal(timers.size, 1);
  s.stop();
  assert.equal(timers.size, 0);
  assert.equal(s.play.disabled, false);
});
await test("Stopping while audio resumes prevents a delayed restart", async () => {
  const { s, resume, timers } = transportFixture();
  const a = s.start();
  s.stop();
  resume.resolve();
  await a;
  assert.equal(timers.size, 0);
  assert.equal(s.playing, false);
  assert.equal(s.play.disabled, false);
});
await test("A failed audio activation allows a later retry", async () => {
  const { s, resume, timers } = transportFixture();
  const a = s.start();
  resume.reject(Error("blocked"));
  await a;
  assert.equal(s.starting, false);
  assert.equal(s.play.disabled, false);
  assert.equal(timers.size, 0);
  assert.match(s.status.textContent, /blocked/);
});
await test("Cutter imports commit only the latest decoded file", async () => {
  const a = deferred(),
    revoked = [],
    durationChecks = [];
  class AudioProbe {
    constructor() {
      this.events = {};
    }
    addEventListener(name, callback) {
      this.events[name] = callback;
    }
    set src(value) {
      this.url = value;
    }
    removeAttribute() {
      this.url = null;
    }
    pause() {}
    load() {
      if (this.url) queueMicrotask(() => this.events.loadedmetadata());
    }
  }
  const s = {
    window: {
      BeatLabCore: {
        ...testCore,
        checkAudioFileDuration: async (blob, maxSeconds) => {
          durationChecks.push(maxSeconds);
          return 1;
        },
      },
    },
    fileLoad: core.latestOperation(),
    Audio: AudioProbe,
    stop() {},
    enable() {},
    message: {},
    ensureAudio: () => ({
      decodeAudioData: async (bytes) => ({
        id: bytes.id,
        duration: 1,
        numberOfChannels: 2,
        sampleRate: 48000,
      }),
    }),
    buffer: null,
    fileUrl: null,
    URL: {
      createObjectURL: (f) => f.name,
      revokeObjectURL: (u) => revoked.push(u),
    },
    media: { pause() {}, load() {}, removeAttribute() {} },
    startInput: {},
    endInput: {},
    filename: {},
    meta: {},
    fitCanvas() {},
    setSelection() {},
    timeText: (x) => String(x),
    draw() {},
  };
  bind(s, fn(cut, "releaseCurrentAudio") + "async " + fn(cut, "loadFile"));
  const bytes = (id) => ({
    id,
    slice() {
      return this;
    },
  });
  const first = s.loadFile(file("A", () => a.promise));
  await s.loadFile(file("B", async () => bytes("B")));
  a.resolve(bytes("A"));
  await first;
  assert.equal(s.filename.textContent, "B.wav", s.message.textContent);
  assert.equal(s.buffer.id, "B");
  assert.equal(s.fileUrl, "B.wav");
  assert.deepEqual(durationChecks, [300, 300]);
});
await test("A failed cutter import keeps the previously loaded file", async () => {
  const testCore = {
    ...core,
    checkAudioFileDuration: async () => {
      throw Error("durée trop longue");
    },
  };
  let enabled;
  const s = {
    window: { BeatLabCore: testCore },
    fileLoad: core.latestOperation(),
    stop() {},
    enable: (value) => (enabled = value),
    message: {},
    buffer: { id: "previous" },
    fileUrl: "previous.wav",
    startInput: {},
    endInput: {},
    filename: { textContent: "previous.wav" },
    meta: { textContent: "old metadata" },
    media: {},
  };
  bind(s, fn(cut, "releaseCurrentAudio") + "async " + fn(cut, "loadFile"));
  await s.loadFile(file("too-long"));
  assert.equal(s.buffer.id, "previous");
  assert.equal(s.fileUrl, "previous.wav");
  assert.equal(enabled, true);
  assert.match(s.message.textContent, /L’ancien fichier reste chargé/);
});
await test("Cutter rejects decoded audio beyond its five-minute cap", async () => {
  let enabled;
  const s = {
    window: { BeatLabCore: testCore },
    fileLoad: core.latestOperation(),
    stop() {},
    enable: (value) => (enabled = value),
    message: {},
    buffer: { id: "previous" },
    fileUrl: "previous.wav",
    startInput: {},
    endInput: {},
    ensureAudio: () => ({
      decodeAudioData: async () => ({ duration: 300.01 }),
    }),
  };
  bind(s, fn(cut, "releaseCurrentAudio") + "async " + fn(cut, "loadFile"));
  await s.loadFile(
    file("decoded-too-long", async () => ({ slice() { return this; } })),
  );
  assert.equal(s.buffer.id, "previous");
  assert.equal(s.fileUrl, "previous.wav");
  assert.equal(enabled, true);
  assert.match(s.message.textContent, /5 minutes/);
});
await test("Cutter metadata finishing late cannot replace the current file; its URL is released", async () => {
  const probes = [],
    revoked = [];
  class AudioProbe {
    constructor() {
      this.events = {};
      probes.push(this);
    }
    addEventListener(name, callback) {
      this.events[name] = callback;
    }
    set src(value) {
      this.url = value;
    }
    removeAttribute() {
      this.url = null;
    }
    pause() {}
    load() {
      if (this.url === "B.wav")
        queueMicrotask(() => this.events.loadedmetadata());
    }
  }
  const bytes = (id) => ({
    id,
    slice() {
      return this;
    },
  });
  const s = {
    window: { BeatLabCore: testCore },
    fileLoad: core.latestOperation(),
    Audio: AudioProbe,
    stop() {},
    enable() {},
    message: {},
    ensureAudio: () => ({
      decodeAudioData: async (bytes) => ({
        id: bytes.id,
        duration: 1,
        numberOfChannels: 2,
        sampleRate: 48000,
      }),
    }),
    buffer: null,
    fileUrl: null,
    URL: {
      createObjectURL: (f) => f.name,
      revokeObjectURL: (u) => revoked.push(u),
    },
    media: { pause() {}, load() {}, removeAttribute() {} },
    startInput: {},
    endInput: {},
    filename: {},
    meta: {},
    fitCanvas() {},
    setSelection() {},
    timeText: (x) => String(x),
    draw() {},
  };
  bind(s, fn(cut, "releaseCurrentAudio") + "async " + fn(cut, "loadFile"));
  const a = s.loadFile(file("A", async () => bytes("A")));
  await tick();
  await s.loadFile(file("B", async () => bytes("B")));
  probes[0].events.loadedmetadata();
  await a;
  assert.equal(s.filename.textContent, "B.wav");
  assert.equal(s.fileUrl, "B.wav");
  assert.deepEqual(revoked, ["A.wav"]);
});
await test("Replacing a cutter file detaches the old media source and releases its buffer reference", async () => {
  const mediaCalls = [],
    revoked = [];
  class AudioProbe {
    constructor() { this.events = {}; }
    addEventListener(name, callback) { this.events[name] = callback; }
    set src(value) { this.url = value; }
    removeAttribute() { this.url = null; }
    pause() {}
    load() { queueMicrotask(() => this.events.loadedmetadata?.()); }
  }
  const s = {
    window: { BeatLabCore: testCore },
    fileLoad: core.latestOperation(),
    Audio: AudioProbe,
    stop() {},
    enable() {},
    message: {},
    ensureAudio: () => ({
      decodeAudioData: async () => ({ duration: 1, numberOfChannels: 2, sampleRate: 48000 }),
    }),
    buffer: { id: "old-buffer" },
    waveBase: { id: "old-wave" },
    waveAccent: { id: "old-accent" },
    fileUrl: "old.wav",
    URL: {
      createObjectURL: (f) => f.name,
      revokeObjectURL: (url) => revoked.push(url),
    },
    media: {
      pause() { mediaCalls.push("pause"); },
      removeAttribute() { mediaCalls.push("remove src"); },
      load() { mediaCalls.push("load"); },
      set src(value) { mediaCalls.push("src " + value); },
    },
    startInput: {}, endInput: {}, filename: {}, meta: {}, fitCanvas() {},
    setSelection() {}, timeText: (x) => String(x), draw() {},
  };
  bind(s, fn(cut, "releaseCurrentAudio") + "async " + fn(cut, "loadFile"));
  await s.loadFile(file("new", async () => ({ slice() { return this; } })));
  assert.equal(s.buffer.duration, 1);
  assert.equal(s.waveBase, null);
  assert.equal(s.waveAccent, null);
  assert.equal(s.fileUrl, "new.wav");
  assert.deepEqual(mediaCalls.slice(0, 3), ["pause", "remove src", "load"]);
  assert.deepEqual(revoked, ["old.wav"]);
});
await test("A sample removal runs after an in-flight write and blocks imports until finished", async () => {
  const s = trackFixture(),
    saved = deferred();
  s.dbPut = async (id, entry) => {
    s.writes.push(entry.name);
    await saved.promise;
  };
  const a = s.importSample(s.track, file("A"));
  await tick();
  const removal = s.removeSample(s.track);
  assert.equal(s.track._input.disabled, true);
  await s.importSample(s.track, file("B"));
  saved.resolve();
  await Promise.all([a, removal]);
  assert.equal(s.track.buffer, null);
  assert.deepEqual(s.writes, ["A.wav", "delete"]);
  assert.equal(s.track._input.disabled, false);
});
await test("Both production schedulers share the same swing timing at all tested tempos", async () => {
  for (const bpm of [60, 96, 100, 160])
    for (const swing of [false, true]) {
      const d = [],
        q = [];
      bind(
        {
          window: { BeatLabCore: core },
          ctx: { currentTime: 1 },
          nextTime: 0,
          lookahead: 0.12,
          step: 0,
          tempo: { value: bpm },
          swing: { checked: swing },
          schedule: (n, t) => d.push(t),
        },
        fn(source("index"), "scheduler") + ";scheduler()",
      );
      bind(
        {
          core,
          playing: true,
          ctx: { currentTime: 1 },
          nextTime: 0,
          step: 0,
          length: { value: 16 },
          tracks: [{ steps: Array(16).fill(true) }],
          trigger: (t, time) => q.push(time),
          setTimeout: () => 1,
          paintTimers: new Set(),
          paintPlayhead() {},
          tempo: { value: bpm },
          swing: { checked: swing },
        },
        fn(seq, "scheduler") + ";scheduler()",
      );
      assert.deepEqual(d.slice(0, 6), q.slice(0, 6));
    }
});
function gameFixture() {
  const waits = [],
    sounds = [];
  const pads = Array.from({ length: 4 }, () => ({
    classList: { remove() {} },
    focus() {},
  }));
  const s = {
    window: { BeatLabCore: core },
    session: core.latestOperation(),
    phase: "input",
    sequence: [0, 1],
    inputIndex: 0,
    gameMode: "simon",
    mode: "drums",
    bestByMode: { drums: 0 },
    bestPatternsByMode: { drums: 0 },
    saveScores() {
      s.scoreWrites = (s.scoreWrites || 0) + 1;
    },
    completedPatterns: 0,
    tempo: 630,
    keyboardGame: false,
    pads,
    flashVersions: [0, 0, 0, 0],
    activeSounds: new Set(),
    audioContext: { state: "running", currentTime: 0 },
    document: { body: {}, activeElement: {} },
    startButton: { focus() {} },
    stopButton: {},
    setPadsDisabled() {},
    setModeControlsDisabled() {},
    updateStatus: (message) => (s.message = message),
    makeSound: (id) => sounds.push(id),
    updateRoundLabel() {},
    wait: () => {
      const d = deferred();
      waits.push(d);
      return d.promise;
    },
    beginRound: () => (s.rounds = (s.rounds || 0) + 1),
    flash: async () => {},
  };
  bind(s, "async " + fn(game, "fail") + "\n" + fn(game, "stopGame"));
  const marker = game.indexOf('pad.addEventListener("click", async () => {');
  assert.ok(marker >= 0);
  const lambda = block(game, game.indexOf("async () => {", marker));
  s.handler = vm.runInContext("(id=>(" + lambda + "))", s);
  return { s, waits, sounds };
}
await test("Two correct game responses are accepted without waiting for animation", async () => {
  const { s, waits } = gameFixture();
  await s.handler(0)();
  const second = s.handler(1)();
  assert.equal(s.inputIndex, 2);
  assert.equal(s.phase, "between");
  assert.equal(s.bestByMode.drums, 2);
  assert.equal(s.scoreWrites, 1);
  s.stopGame();
  waits[0].resolve();
  await second;
  assert.equal(s.rounds, undefined);
  assert.match(s.message, /Partie arrêtée/);
});
await test("A failure at the first round reports zero successful sounds", async () => {
  const { s, waits } = gameFixture();
  s.sequence = [0];
  const failure = s.fail();
  waits[0].resolve();
  await failure;
  assert.match(s.message, /0 son\./);
  assert.doesNotMatch(s.message, /retrouvé 1/);
  assert.equal(s.startButton.disabled, false);
  assert.equal(s.stopButton.disabled, true);
  assert.match(core.gameResult(1, "notes"), /1 note\./);
  assert.match(core.gameResult(2, "notes"), /2 notes\./);
});
await test("Stopping during the failure sound prevents stale messages", async () => {
  const { s, waits, sounds } = gameFixture();
  const failure = s.fail();
  s.stopGame();
  waits[0].resolve();
  await failure;
  assert.match(s.message, /Partie arrêtée/);
  assert.equal(sounds.length, 1);
});
await test("Stopping playback prevents pending notes and response prompts", async () => {
  const { s, waits } = gameFixture();
  s.phase = "playback";
  bind(s, "async " + fn(game, "playSequence"));
  const playback = s.playSequence();
  assert.equal(waits.length, 1);
  s.stopGame();
  waits[0].resolve();
  await playback;
  assert.equal(s.phase, "idle");
  assert.match(s.message, /Partie arrêtée/);
});
await test("Groove exits playback cleanly if audio suspends during the lead-in", async () => {
  const { s, waits } = gameFixture();
  s.phase = "playback";
  let stoppedMessage = "";
  s.stopForInterruption = (message) => {
    s.phase = "idle";
    s.startButton.disabled = false;
    stoppedMessage = message;
  };
  bind(s, "async " + fn(game, "playSequence"));
  const playback = s.playSequence();
  assert.equal(waits.length, 1);
  s.audioContext.state = "suspended";
  waits[0].resolve();
  await playback;
  assert.equal(s.phase, "idle");
  assert.match(stoppedMessage, /suspendu pendant l’écoute/);
});
await test("Groove exits playback cleanly if audio suspends during the sequence", async () => {
  const { s, waits } = gameFixture();
  s.phase = "playback";
  let stoppedMessage = "";
  s.stopForInterruption = (message) => {
    s.phase = "idle";
    s.startButton.disabled = false;
    stoppedMessage = message;
  };
  bind(s, "async " + fn(game, "playSequence"));
  const playback = s.playSequence();
  waits[0].resolve();
  await tick();
  assert.equal(waits.length, 2);
  s.audioContext.state = "suspended";
  waits[1].resolve();
  await playback;
  assert.equal(s.phase, "idle");
  assert.match(stoppedMessage, /suspendu pendant l’écoute/);
});
await test("Effects invalidate the previous buffer when a newly selected file is rejected", async () => {
  const s = {
    loadToken: 0,
    inputBuffer: { id: "old-audio" },
    renderButton: { disabled: false },
    previewButton: { disabled: false },
    name: { textContent: "old.wav" },
    window: {
      BeatLabCore: {
        checkAudioFile() { throw new Error("Fichier trop volumineux"); },
      },
    },
    stopPreview() { s.previewStopped = true; },
    clearRender() { s.renderCleared = true; },
    setStatus(message) { s.status = message; },
  };
  bind(s, "async " + fn(source("effects"), "loadSelectedFile"));
  await s.loadSelectedFile({ name: "rejected.wav" });
  assert.equal(s.inputBuffer, null);
  assert.equal(s.renderButton.disabled, true);
  assert.equal(s.previewButton.disabled, true);
  assert.equal(s.name.textContent, "Aucun fichier chargé");
  assert.equal(s.previewStopped, true);
  assert.equal(s.renderCleared, true);
  assert.match(s.status, /Fichier trop volumineux/);
});
await test("Effects clear the file input after selection so the same file can be retried", async () => {
  const selected = { name: "same.wav" },
    calls = [],
    control = {
      files: [selected],
      value: "same.wav",
      addEventListener(name, callback) {
        assert.equal(name, "change");
        this.onchange = callback;
      },
    };
  const handler = block(
    effectsSource,
    effectsSource.indexOf('file.addEventListener("change"'),
  );
  const scope = bind(
    { file: control, loadSelectedFile: async (item) => calls.push(item) },
    handler + ");",
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    control.files = [selected];
    control.value = "same.wav";
    scope.file.onchange();
  }
  await tick();
  assert.deepEqual(calls, [selected, selected]);
  assert.equal(control.value, "");
});
await test("Effects preview creates reverb only when its control is above zero", async () => {
  let settings = { cut: 12000, drive: 0, delay: 0, reverb: 0 },
    convolvers = 0,
    connected = 0,
    disconnected = 0;
  const param = () => ({
    value: 0,
    setTargetAtTime(value) { this.value = value; },
    setValueAtTime(value) { this.value = value; },
  });
  const node = () => ({ connect(next) { return next; } });
  const context = {
    currentTime: 0,
    createConvolver() { convolvers++; return { ...node(), buffer: null }; },
    createGain() { return { ...node(), gain: param() }; },
  };
  const active = {
    context,
    filter: { frequency: param() },
    distortion: {
      connect() { connected++; return node(); },
      disconnect() { disconnected++; },
      curve: null,
    },
    dry: { gain: param() },
    delayWet: null,
    reverbWet: null,
    output: node(),
    nodes: [],
  };
  const scope = bind(
    {
      preview: active,
      readSettings: () => settings,
      makeDriveCurve: () => ({}),
      makeImpulse: () => ({ id: "impulse" }),
    },
    fn(effectsSource, "smoothParam") + fn(effectsSource, "updatePreview"),
  );
  scope.updatePreview();
  assert.equal(convolvers, 0);
  assert.equal(connected, 0);
  settings = { ...settings, reverb: 0.4 };
  scope.updatePreview();
  assert.equal(convolvers, 1);
  assert.equal(connected, 1);
  assert.ok(active.reverbWet);
  settings = { ...settings, reverb: 0 };
  scope.updatePreview();
  assert.equal(disconnected, 1);
  settings = { ...settings, reverb: 0.2 };
  scope.updatePreview();
  assert.equal(convolvers, 1);
  assert.equal(connected, 2);
});
await test("Cancelled Effects rendering returns while its offline work continues", async () => {
  let resolveCheckpoint, resolveRendering, settled = false, renderSettled = false;
  const context = {
    length: 2,
    sampleRate: 1,
    suspend() { return new Promise((resolve) => { resolveCheckpoint = resolve; }); },
    resume() { return Promise.resolve(); },
    startRendering() {
      return new Promise((resolve) => { resolveRendering = resolve; }).then((value) => {
        renderSettled = true;
        return value;
      });
    },
  };
  const run = vm.runInNewContext(
    "async " + fn(effectsSource, "renderOfflineCancellable") + ";renderOfflineCancellable",
  );
  const operation = { cancelled: true };
  const pending = run(context, operation, () => {}).then((value) => { settled = true; return value; });
  resolveCheckpoint();
  await tick();
  const result = await pending;
  assert.equal(settled, true);
  assert.equal(renderSettled, false);
  assert.equal(result.cancelled, true);
  assert.equal(typeof result.background.then, "function");
  resolveRendering({ id: "finished" });
  await result.background;
  assert.equal(renderSettled, true);
});
await test("Effects cannot start a second render while a cancelled render is still pending", async () => {
  const scope = {
    inputBuffer: { id: "source" },
    renderButton: { disabled: false },
    activeRender: { cancelled: true },
    stopPreview() { assert.fail("a second render must not start"); },
  };
  const marker = 'renderButton.addEventListener("click", async () => {',
    body = block(effectsSource, effectsSource.indexOf("{", effectsSource.indexOf(marker))),
    handler = vm.runInNewContext(`async () => ${body}`, scope);
  await handler();
});
await test("Effects unlocks other controls but holds the render lock until background work settles", async () => {
  const operation = { cancelled: true },
    background = deferred(),
    scope = {
      activeRender: operation,
      renderUiBusy: true,
      renderToken: 4,
      inputBuffer: { id: "source" },
      defaultRenderText: "Créer le rendu et préparer l’écoute",
      file: { disabled: true },
      controls: [{ disabled: true }],
      renderButton: { disabled: true, textContent: "" },
      previewButton: {
        disabled: true,
        textContent: "",
        setAttribute() {},
      },
      cancelRenderButton: { hidden: false, disabled: true },
      preview: null,
      status: { textContent: "" },
      setStatus(message) { scope.status.textContent = message; },
    };
  bind(
    scope,
    fn(effectsSource, "setPreviewBusy") +
      fn(effectsSource, "updateRenderButton") +
      fn(effectsSource, "setBusy") +
      fn(effectsSource, "releaseBackgroundRender") +
      "globalThis.setBusy = setBusy;globalThis.releaseBackgroundRender = releaseBackgroundRender;",
  );
  scope.setBusy(false);
  scope.releaseBackgroundRender(operation, 4, background.promise);
  assert.equal(scope.file.disabled, false);
  assert.equal(scope.controls[0].disabled, false);
  assert.equal(scope.previewButton.disabled, false);
  assert.equal(scope.renderButton.disabled, true);
  assert.match(scope.renderButton.textContent, /arrière-plan/);
  assert.equal(scope.activeRender, operation);
  background.resolve();
  await tick();
  assert.equal(scope.activeRender, null);
  assert.equal(scope.renderButton.disabled, false);
  assert.equal(scope.renderButton.textContent, scope.defaultRenderText);
  assert.match(scope.status.textContent, /aucun rendu n’a été conservé/);
});
await test("An obsolete cancelled render keeps its lock without overwriting newer file status", async () => {
  const operation = { cancelled: true },
    background = deferred(),
    scope = {
      activeRender: operation,
      renderUiBusy: false,
      renderToken: 5,
      inputBuffer: { id: "new-source" },
      defaultRenderText: "Créer le rendu et préparer l’écoute",
      file: { disabled: false },
      controls: [{ disabled: false }],
      renderButton: { disabled: false, textContent: "" },
      previewButton: {
        disabled: false,
        textContent: "",
        setAttribute() {},
      },
      cancelRenderButton: { hidden: true, disabled: true },
      preview: null,
      status: { textContent: "Fichier prêt · nouvel audio" },
      setStatus(message) { scope.status.textContent = message; },
    };
  bind(
    scope,
    fn(effectsSource, "setPreviewBusy") +
      fn(effectsSource, "updateRenderButton") +
      fn(effectsSource, "setBusy") +
      fn(effectsSource, "releaseBackgroundRender") +
      "globalThis.setBusy = setBusy;globalThis.releaseBackgroundRender = releaseBackgroundRender;",
  );
  scope.setBusy(false);
  scope.releaseBackgroundRender(operation, 4, background.promise);
  assert.equal(scope.renderButton.disabled, true);
  background.resolve();
  await tick();
  assert.equal(scope.activeRender, null);
  assert.equal(scope.renderButton.disabled, false);
  assert.equal(scope.status.textContent, "Fichier prêt · nouvel audio");
});
await test("Effects immediately releases controls and explains the background render lock", async () => {
  const scope = {
    activeRender: { cancellable: true, cancelled: false },
    cancelRenderButton: { disabled: false },
    message: "",
    setStatus(value) { scope.message = value; },
    setBusy(value) { scope.released = value === false; },
  };
  runCapturedHandler(
    effectsSource,
    'cancelRenderButton.addEventListener("click", () => {',
    scope,
  );
  scope.capturedHandler();
  assert.equal(scope.activeRender.cancelled, true);
  assert.equal(scope.cancelRenderButton.disabled, true);
  assert.equal(scope.released, true);
  assert.match(scope.message, /les autres commandes sont disponibles/);
});
await test("The cutter canvas is keyboard focusable and normalization protects near-silence", async () => {
  const html = fs.readFileSync(path.join(root, "samples.html"), "utf8"),
    canvas = html.match(/<canvas[^>]*id="wave"[^>]*>/)?.[0];
  assert.ok(canvas);
  assert.match(canvas, /tabindex="0"/);
  const gain = vm.runInNewContext(
    fn(cut, "normalizationGainForPeak") + ";normalizationGainForPeak",
  );
  assert.equal(gain(0), 1);
  assert.equal(gain(0.0009), 1);
  assert.equal(gain(0.001), 4);
  assert.equal(gain(0.05), 4);
  assert.ok(Math.abs(gain(0.5) - 1.78250188) < 1e-8);
  assert.ok(gain(1) < 1);
});
await test("The cutter reports media-element playback errors with their cause", async () => {
  const scope = {
    fileUrl: "blob:current",
    media: { currentSrc: "blob:current", error: { code: 4 } },
    mediaPlaying: true,
    raf: 9,
    message: { textContent: "" },
    cancelAnimationFrame(id) { assert.equal(id, 9); },
    updatePausedPosition() { scope.updated = true; },
  };
  const marker = 'media.addEventListener("error", () => {',
    handlerBody = block(cut, cut.indexOf("{", cut.indexOf(marker)));
  bind(
    scope,
    fn(cut, "mediaErrorDetail") +
      `;globalThis.errorHandler = () => ${handlerBody};`,
  );
  scope.errorHandler();
  assert.equal(scope.mediaPlaying, false);
  assert.match(scope.message.textContent, /format n’est pas pris en charge/);
  assert.equal(scope.updated, true);
});
await test("Groove reuses white-noise buffers for repeated pad sounds", async () => {
  let created = 0;
  const makeContext = () => ({
    sampleRate: 1000,
    createBuffer(channels, length, sampleRate) {
      created++;
      assert.equal(channels, 1);
      assert.equal(sampleRate, 1000);
      return { length, getChannelData: () => new Float32Array(length) };
    },
  });
  const context = makeContext(),
    otherContext = makeContext();
  const scope = bind({ noiseBuffers: new WeakMap() }, fn(game, "noiseBufferFor"));
  const first = scope.noiseBufferFor(context, 0.09);
  assert.equal(scope.noiseBufferFor(context, 0.09), first);
  assert.notEqual(scope.noiseBufferFor(context, 0.11), first);
  assert.notEqual(scope.noiseBufferFor(otherContext, 0.09), first);
  assert.equal(created, 3);
});
console.log(
  JSON.stringify({ passed: results.length, tests: results }, null, 2),
);
