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
    const localAsset = asset.startsWith("/beat-lab-808/")
      ? asset.slice("/beat-lab-808/".length)
      : asset.replace(/^\/+/, "");
    const digest = createHash("sha256")
      .update(fs.readFileSync(path.join(root, localAsset)))
      .digest("hex")
      .slice(0, version.length);
    assert.equal(version, digest, `${htmlName} cache version for ${asset}`);
  }
}
for (const htmlName of [
  "ateliers.html",
  "sequencer.html",
  "groove-mystere.html",
  "index.html",
  "samples.html",
  "effects.html",
]) {
  const html = fs.readFileSync(path.join(root, htmlName), "utf8");
  assert.match(html, /name="twitter:title"/, `${htmlName} Twitter title`);
  assert.match(html, /name="twitter:description"/, `${htmlName} Twitter description`);
  assert.match(html, /name="twitter:image"/, `${htmlName} Twitter image`);
}
const mobileStyles = fs.readFileSync(path.join(root, "mobile-compact.css"), "utf8");
assert.match(mobileStyles, /\.desktop-mobile-copy[^\{]*\{\s*display:\s*none/);
assert.match(mobileStyles, /\.mobile-context\s*\{\s*display:\s*block/);
const sequencerHtml = fs.readFileSync(path.join(root, "sequencer.html"), "utf8");
assert.match(sequencerHtml, /id="grid"[\s\S]*?role="grid"/);
const sequencerScript = fs.readFileSync(path.join(root, "sequencer.js"), "utf8");
assert.match(sequencerScript, /b\.hidden\s*=\s*hidden/);
assert.match(sequencerScript, /cell\.hidden\s*=\s*si\s*>=\s*Number\(length\.value\)/);
const cutterHtml = fs.readFileSync(path.join(root, "samples.html"), "utf8");
const cutterCss = fs.readFileSync(path.join(root, "samples.css"), "utf8");
assert.match(cutterHtml, /id="message"[\s\S]*?aria-live="polite"/);
assert.match(cutterCss, /\.wavebox canvas\{[^}]*touch-action:none/);
assert.match(fs.readFileSync(path.join(root, "effects.js"), "utf8"), /output\.connect\(makeOutputCompressor\(context\)\)\.connect\(context\.destination\)/);
for (const scriptName of ["sequencer.js", "samples.js", "effects.js"]) {
  const script = fs.readFileSync(path.join(root, scriptName), "utf8");
  const durationCheck = script.indexOf("checkAudioFileDuration(");
  const read = script.indexOf(".arrayBuffer()", durationCheck);
  const decode = script.indexOf("decodeAudioData(", durationCheck);
  assert.ok(durationCheck >= 0 && read > durationCheck && decode > read, `${scriptName} checks metadata before reading and decoding`);
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
    fn(cutter, "exportChannelNote") +
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
const keyboardNavigationClasses = new Set();
const keyboardNavigationListeners = {};
const grid = {
  classList: {
    add(name) { keyboardNavigationClasses.add(name); },
    remove(name) { keyboardNavigationClasses.delete(name); },
  },
  addEventListener(type, listener) { keyboardNavigationListeners[type] = listener; },
};
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
    closest(selector) { return selector === ".grid" ? grid : null; },
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
assert.equal(keyboardNavigationClasses.has("keyboard-navigation"), true);
keyboardNavigationListeners.pointerdown();
assert.equal(keyboardNavigationClasses.has("keyboard-navigation"), false);
key(rows[0][1], "ArrowDown");
assert.equal(document.activeElement, rows[1][1]);
assert.equal(keyboardNavigationClasses.has("keyboard-navigation"), true);
key(rows[1][1], "End");
assert.equal(document.activeElement, rows[1][15]);
visible = 8;
navigation.sync();
assert.equal(document.activeElement, rows[1][7]);
rows[0][0].focus();
assert.equal(key(rows[0][0], "PageDown"), true);
assert.equal(document.activeElement, rows[0][4]);
assert.equal(key(rows[0][4], "PageUp"), true);
assert.equal(document.activeElement, rows[0][0]);
assert.equal(rows.flat().filter((b) => b.tabIndex === 0).length, 1);
assert.equal(key(rows[1][7], "Tab"), false);
assert.equal(key(rows[1][7], " "), false);

window.BeatLabGrid([], () => 16).sync();
window.BeatLabGrid([[], []], () => 16).sync();
const raggedDocument = { activeElement: null };
const makeButton = () => ({
  tabIndex: -1,
  listeners: {},
  addEventListener(type, listener) {
    this.listeners[type] = listener;
  },
  focus() {
    raggedDocument.activeElement = this;
    this.listeners.focus();
  },
});
const raggedRows = [[makeButton(), makeButton(), makeButton()], [], [makeButton()]];
const raggedWindow = {};
vm.runInNewContext(fs.readFileSync(path.join(root, "lab-grid.js"), "utf8"), {
  window: raggedWindow,
  document: raggedDocument,
});
raggedWindow.BeatLabGrid(raggedRows, () => 16);
raggedRows[0][2].focus();
assert.equal(key(raggedRows[0][2], "ArrowDown"), true);
assert.equal(raggedDocument.activeElement, raggedRows[2][0]);
assert.equal(raggedRows.flat().filter((b) => b.tabIndex === 0).length, 1);

const pageNames = [
  "ateliers.html",
  "groove-mystere.html",
  "sequencer.html",
  "index.html",
  "samples.html",
  "effects.html",
];
for (const page of pageNames) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  assert.match(
    html,
    new RegExp(
      `<link rel="canonical" href="https://izzyashtn\\.github\\.io/beat-lab-808/${page}">`,
    ),
    `${page} canonical URL`,
  );
}
const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
assert.match(robots, /Sitemap: https:\/\/izzyashtn\.github\.io\/beat-lab-808\/sitemap\.xml/);
for (const page of pageNames)
  assert.ok(sitemap.includes(`https://izzyashtn.github.io/beat-lab-808/${page}`));
assert.match(fs.readFileSync(path.join(root, "404.html"), "utf8"), /name="robots" content="noindex"/);
assert.match(fs.readFileSync(path.join(root, "lab-shared.css"), "utf8"), /:focus-visible\s*\{\s*outline:3px solid/);
for (const page of ["index.html", "sequencer.html"])
  assert.match(fs.readFileSync(path.join(root, page), "utf8"), /lab-shared\.css/);
assert.match(fs.readFileSync(path.join(root, "lab-tools.css"), "utf8"), /\.pad\.on\s*\{\s*border-color:\s*var\(--tone,\s*var\(--acid\)\)/);
assert.match(fs.readFileSync(path.join(root, "lab-tools.css"), "utf8"), /\.grid\.keyboard-navigation \.pad:focus\s*\{[^}]*outline: 3px solid #d8f36a/);
assert.match(fs.readFileSync(path.join(root, "index.js"), "utf8"), /piste \$\{trackIndex \+ 1\} sur \$\{tracks\.length\}, pas \$\{stepIndex \+ 1\} sur 16/);
assert.match(fs.readFileSync(path.join(root, "sequencer.js"), "utf8"), /lengthAnnouncement\.textContent/);
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
      gridEdgeCasesPassed: true,
      pageNavigationPassed: true,
      seoAndKeyboardFocusMarkersPassed: true,
      sampleDeletionErrorsReported: true,
      scriptsParsed: 5,
    },
    null,
    2,
  ),
);
