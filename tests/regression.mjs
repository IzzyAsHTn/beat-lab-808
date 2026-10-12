import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(
  process.argv[2] ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const core = createRequire(import.meta.url)(path.join(root, "lab-core.js"));
for (const htmlName of fs.readdirSync(root).filter((name) => name.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(root, htmlName), "utf8");
  for (const [, asset, version] of html.matchAll(
    /(?:src|href)="([^"]+\.(?:css|js))\?v=([a-f0-9]+)"/g,
  )) {
    const digest = createHash("sha256")
      .update(fs.readFileSync(path.join(root, asset)))
      .digest("hex")
      .slice(0, version.length);
    assert.equal(version, digest, `${htmlName} cache version for ${asset}`);
  }
}
await (async () => {
  let audioDuration = 121;
  class AudioProbe {
    constructor() {
      this.duration = audioDuration;
    }
    load() {
      if (this.onloadedmetadata)
        queueMicrotask(() => this.onloadedmetadata?.());
    }
    pause() {}
    removeAttribute() {}
  }
  const revoked = [];
  const window = {
    Audio: AudioProbe,
    URL: {
      createObjectURL: () => "blob:test",
      revokeObjectURL: (url) => revoked.push(url),
    },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "lab-core.js"), "utf8"), {
    window,
  });
  await assert.rejects(
    window.BeatLabCore.checkAudioFileDuration({}),
    /limite est de 2 minutes/,
  );
  audioDuration = 120;
  assert.equal(await window.BeatLabCore.checkAudioFileDuration({}), 120);
  audioDuration = 120.01;
  await assert.rejects(
    window.BeatLabCore.checkAudioFileDuration({}),
    /limite est de 2 minutes/,
  );
  audioDuration = 300;
  assert.equal(await window.BeatLabCore.checkAudioFileDuration({}, 300), 300);
  audioDuration = 300.01;
  await assert.rejects(
    window.BeatLabCore.checkAudioFileDuration({}, 300),
    /limite est de 5 minutes/,
  );
  assert.equal(revoked.length, 5);
})();
function program(name) {
  const external = path.join(root, name + ".js");
  if (fs.existsSync(external)) return fs.readFileSync(external, "utf8");
  return fs
    .readFileSync(path.join(root, name + ".html"), "utf8")
    .match(/<script>([\s\S]*?)<\/script>/)[1];
}
// Use an explicit brace scanner: strings (including template literals) are skipped.
function fn(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.ok(start >= 0, name);
  let quote = "",
    escape = false,
    depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw Error("Unclosed function " + name);
}
const drums = program("index"),
  cutter = program("samples");
assert.equal(
  vm.runInNewContext(fn(cutter, "normalizationGainForPeak") + ";normalizationGainForPeak(0.25);"),
  0.89125094 / 0.25,
);
assert.equal(
  vm.runInNewContext(fn(cutter, "normalizationGainForPeak") + ";normalizationGainForPeak(0);"),
  1,
);
const sequencerSource = program("sequencer"),
  fxStart = sequencerSource.indexOf("const FX_RANGES ="),
  fxEnd = sequencerSource.indexOf("const tracks = defs.map", fxStart),
  restoreFx = fn(sequencerSource, "restoreFx"),
  lowerBoundsFx = vm.runInNewContext(
    sequencerSource.slice(fxStart, fxEnd) +
      restoreFx +
      "; restoreFx(target, saved); JSON.stringify(target);",
    {
      target: { filter: 18000, drive: 0, delay: 0, reverb: 0 },
      saved: { filter: -500, drive: -80, delay: -20, reverb: "invalid" },
    },
  );
assert.deepEqual(JSON.parse(lowerBoundsFx), {
  filter: 500,
  drive: 0,
  delay: 0,
  reverb: 0,
});
const upperBoundsFx = vm.runInNewContext(
  sequencerSource.slice(fxStart, fxEnd) +
    restoreFx +
    "; restoreFx(target, saved); JSON.stringify(target);",
  {
    target: { filter: 500, drive: 0, delay: 0, reverb: 0 },
    saved: { filter: 999999, drive: 500, delay: 1200, reverb: 150 },
  },
);
assert.deepEqual(JSON.parse(upperBoundsFx), {
  filter: 18000,
  drive: 100,
  delay: 100,
  reverb: 100,
});
const wavBlobs = [];
let wavDownload = "";
const wavScope = {
  buffer: {
    sampleRate: 8000,
    length: 8,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([-0.25, 0.5, 0, 0, 0, 0, 0, 0]),
  },
  selectionStart: 0,
  selectionEnd: 2 / 8000,
  filename: { textContent: "test.wav" },
  message: { textContent: "" },
  Blob,
  URL: {
    createObjectURL: (blob) => (wavBlobs.push(blob), "blob:wav"),
    revokeObjectURL() {},
  },
  document: {
    createElement: () => ({
      click() {},
      set download(value) { wavDownload = value; },
    }),
  },
  setTimeout(callback) { callback(); },
};
vm.runInNewContext(
  fn(cutter, "normalizationGainForPeak") +
    fn(cutter, "exportWav") +
    ";exportWav();",
  wavScope,
);
const wavData = new DataView(await wavBlobs[0].arrayBuffer());
assert.equal(String.fromCharCode(...[0, 1, 2, 3].map((i) => wavData.getUint8(i))), "RIFF");
assert.equal(wavData.getUint16(22, true), 1, "WAV should contain one channel");
assert.equal(wavData.getUint32(24, true), 8000, "WAV sample rate");
assert.equal(wavData.getUint32(40, true), 4, "WAV selection length");
assert.ok(Math.abs(wavData.getInt16(44, true) / 32768 + 0.44562547) < 0.0001);
assert.ok(Math.abs(wavData.getInt16(46, true) / 32767 - 0.89125094) < 0.0001);
assert.match(wavDownload, /test-0\.00s-0\.00s\.wav/);
const timing = [];
for (const bpm of [60, 96, 100, 160])
  for (const swing of [false, true]) {
    const times = [];
    vm.runInNewContext(fn(drums, "scheduler") + ";scheduler();", {
      window: { BeatLabCore: core },
      ctx: { currentTime: 4 },
      nextTime: 0,
      lookahead: 0.12,
      step: 0,
      tempo: { value: bpm },
      swing: { checked: swing },
      schedule: (n, t) => times.push(t),
    });
    const quarter = times[4] - times[0];
    assert.ok(
      Math.abs(quarter - 60 / bpm) < 1e-9,
      `Incorrect tempo: ${bpm}, swing=${swing}`,
    );
    if (!swing)
      for (let i = 1; i < times.length; i++)
        assert.ok(Math.abs(times[i] - times[i - 1] - 60 / bpm / 4) < 1e-9);
    timing.push({
      bpm,
      swing,
      effectiveBpm: Number((60 / quarter).toFixed(6)),
    });
  }
const callbacks = [],
  cancelled = new Set(),
  classes = new Set();
const scope = {
  tracks: [],
  ctx: { currentTime: 0 },
  cells: [
    [
      {
        classList: {
          remove: (x) => classes.delete(x),
          add: (x) => classes.add(x),
        },
      },
    ],
  ],
  paintTimers: new Set(),
  setTimeout: (fn) => {
    callbacks.push(fn);
    return callbacks.length;
  },
  clearTimeout: (id) => cancelled.add(id),
  clearInterval() {},
  playing: true,
  timer: 1,
  startVersion: 0,
  playButton: { textContent: "" },
  status: { textContent: "" },
};
vm.runInNewContext(
  fn(drums, "schedule") + ";" + fn(drums, "stop") + ";schedule(0,.1);stop();",
  scope,
);
assert.equal(cancelled.size, 1);
assert.equal(scope.paintTimers.size, 0);
callbacks.forEach((callback) => callback());
assert.equal(classes.size, 0, "Pending callback repainted stopped transport");
let saved = false;
const save = {
  localStorage: {
    setItem() {
      if (!saved) throw Error("QuotaExceededError");
    },
  },
  storageKey: "test",
  tempo: { value: 100 },
  swing: { checked: false },
  kit: { value: "808" },
  tracks: [],
  persistenceStatus: { textContent: "" },
};
vm.runInNewContext(fn(drums, "savePattern") + ";result=savePattern();", save);
assert.equal(save.result, false);
assert.match(save.persistenceStatus.textContent, /Sauvegarde impossible/);
saved = true;
vm.runInNewContext("result=savePattern();", save);
assert.equal(save.result, true);
assert.match(save.persistenceStatus.textContent, /sauvegardés/);
for (const percent of [0, 35, 100]) {
  let volume;
  const tone = {
    stop() {},
    URL: { createObjectURL: () => "", revokeObjectURL() {} },
    makeTestTone() {},
    Audio: class {
      set volume(v) {
        volume = v;
      }
      async play() {}
    },
    gainInput: { value: String(percent) },
    message: { textContent: "" },
  };
  await vm.runInNewContext(
    "async " + fn(cutter, "testOutput") + ";testOutput();",
    tone,
  );
  assert.equal(volume, percent / 100);
}
const sequencer = program("sequencer");
const deletionUnavailable = { openDB: async () => null };
await assert.rejects(
  vm.runInNewContext(
    "async " + fn(sequencer, "dbDelete") + ';dbDelete("test");',
    deletionUnavailable,
  ),
  /indisponible/,
);
const transaction = {
  objectStore() {
    return { delete() {} };
  },
  error: new Error("QuotaExceededError"),
};
const deletionFailed = {
  DB_STORE: "samples",
  openDB: async () => ({
    transaction() {
      return transaction;
    },
  }),
};
const deletionPromise = vm.runInNewContext(
  "async " + fn(sequencer, "dbDelete") + ';dbDelete("test");',
  deletionFailed,
);
const deletionRejected = assert.rejects(deletionPromise, /QuotaExceededError/);
await new Promise((resolve) => setImmediate(resolve));
transaction.onerror();
await deletionRejected;
const document = { activeElement: null };
const rows = Array.from({ length: 2 }, () =>
  Array.from({ length: 32 }, () => ({
    tabIndex: 0,
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    focus() {
      document.activeElement = this;
      this.listeners.focus();
    },
  })),
);
let visible = 16;
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, "lab-grid.js"), "utf8"), {
  window,
  document,
});
const navigation = window.BeatLabGrid(rows, () => visible);
const key = (button, key) => {
  let prevented = false;
  button.listeners.keydown({
    key,
    preventDefault() {
      prevented = true;
    },
  });
  return prevented;
};
assert.equal(rows.flat().filter((b) => b.tabIndex === 0).length, 1);
rows[0][0].focus();
key(rows[0][0], "ArrowRight");
assert.equal(document.activeElement, rows[0][1]);
key(rows[0][1], "ArrowDown");
assert.equal(document.activeElement, rows[1][1]);
key(rows[1][1], "End");
assert.equal(document.activeElement, rows[1][15]);
visible = 8;
navigation.sync();
assert.equal(document.activeElement, rows[1][7]);
assert.equal(rows.flat().filter((b) => b.tabIndex === 0).length, 1);
assert.equal(key(rows[1][7], "Tab"), false);
assert.equal(key(rows[1][7], " "), false);
for (const name of [
  "index",
  "sequencer",
  "samples",
  "effects",
  "groove-mystere",
])
  new vm.Script(program(name), { filename: name + ".js" });
console.log(
  JSON.stringify(
    {
      timing,
      pendingPaintCancelled: true,
      storageFailureReported: true,
      testVolumeRespected: [0, 35, 100],
      keyboardNavigationPassed: true,
      sampleDeletionErrorsReported: true,
      scriptsParsed: 5,
    },
    null,
    2,
  ),
);
