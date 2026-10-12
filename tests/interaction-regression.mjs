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
const source = (name) => fs.readFileSync(path.join(root, name + ".js"), "utf8");
const seq = source("sequencer"),
  cut = source("samples"),
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
function trackFixture() {
  const scope = {
    core,
    track: {
      id: "track-0",
      name: "Kick",
      load: core.latestOperation(),
      write: core.serialQueue(),
      _input: {},
      _label: {},
      buffer: { id: "previous" },
      fileName: "previous.wav",
    },
    status: { textContent: "" },
    persist: {},
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
  return bind(
    scope,
    ["importSample", "removeSample", "restoreSample"]
      .map((n) => "async " + fn(seq, n))
      .join("\n"),
  );
}
const file = (id, arrayBuffer = async () => ({ id })) => ({
  name: id + ".wav",
  size: 100,
  arrayBuffer,
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
  assert.equal(s.track.fileName, "B.wav");
  assert.deepEqual(s.writes, ["A.wav"]);
  saved.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(s.writes, ["A.wav", "B.wav"]);
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
await test("Oversized files are refused before reading or decoding", async () => {
  core.checkAudioFile({ size: 50_000_000 });
  assert.throws(() => core.checkAudioFile({ size: 50_000_001 }), /50 Mo/);
  const s = trackFixture();
  await s.importSample(s.track, {
    size: 50_000_001,
    arrayBuffer() {
      throw Error("must not read");
    },
  });
  assert.equal(s.track.fileName, "previous.wav");
  assert.equal(s.track.load.version(), 0);
  assert.match(s.status.textContent, /50 Mo/);
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
    revoked = [];
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
    load() {
      if (this.url) queueMicrotask(() => this.events.loadedmetadata());
    }
  }
  const s = {
    window: { BeatLabCore: core },
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
    media: { load() {}, removeAttribute() {} },
    startInput: {},
    endInput: {},
    filename: {},
    meta: {},
    fitCanvas() {},
    setSelection() {},
    timeText: (x) => String(x),
    draw() {},
  };
  bind(s, "async " + fn(cut, "loadFile"));
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
  assert.equal(s.filename.textContent, "B.wav");
  assert.equal(s.buffer.id, "B");
  assert.equal(s.fileUrl, "B.wav");
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
    window: { BeatLabCore: core },
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
    media: { load() {}, removeAttribute() {} },
    startInput: {},
    endInput: {},
    filename: {},
    meta: {},
    fitCanvas() {},
    setSelection() {},
    timeText: (x) => String(x),
    draw() {},
  };
  bind(s, "async " + fn(cut, "loadFile"));
  const a = s.loadFile(file("A", async () => bytes("A")));
  await tick();
  await s.loadFile(file("B", async () => bytes("B")));
  probes[0].events.loadedmetadata();
  await a;
  assert.equal(s.filename.textContent, "B.wav");
  assert.equal(s.fileUrl, "B.wav");
  assert.deepEqual(revoked, ["A.wav"]);
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
    completedPatterns: 0,
    tempo: 630,
    keyboardGame: false,
    pads,
    flashVersions: [0, 0, 0, 0],
    activeSounds: new Set(),
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
console.log(
  JSON.stringify({ passed: results.length, tests: results }, null, 2),
);
