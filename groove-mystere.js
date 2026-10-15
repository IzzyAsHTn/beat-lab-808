const pads = [...document.querySelectorAll(".pad")];
const statusLine = document.getElementById("status");
const roundLabel = document.getElementById("roundLabel");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stopGame");
const session = window.BeatLabCore.latestOperation();
const flashVersions = pads.map(() => 0);
const activeSounds = new Set();
let keyboardGame = false;
const howto = document.getElementById("howto");
const gameModeTitle = document.getElementById("gameModeTitle");
const soundModeButtons = [
  document.getElementById("drumMode"),
  document.getElementById("noteMode"),
];
const gameModeButtons = [
  document.getElementById("simonGame"),
  document.getElementById("patternGame"),
];
const modeButtons = [...soundModeButtons, ...gameModeButtons];
const padSets = {
  drums: [
    { name: "Grosse caisse", glyph: "●", aria: "Grosse caisse" },
    { name: "Caisse claire", glyph: "✳", aria: "Caisse claire" },
    { name: "Charleston", glyph: "◌", aria: "Charleston" },
    { name: "Clap", glyph: "✦", aria: "Clap" },
  ],
  notes: [
    { name: "Sol grave", glyph: "♪", aria: "Note Sol grave" },
    { name: "Do", glyph: "♪", aria: "Note Do" },
    { name: "Mi", glyph: "♪", aria: "Note Mi" },
    { name: "Sol aigu", glyph: "♪", aria: "Note Sol aigu" },
  ],
};
const noteFrequencies = [196.0, 261.63, 329.63, 392.0];
const SCORE_KEY = "beat-lab-groove-scores-v1";
function readScores() {
  const scores = {
    bestByMode: { drums: 0, notes: 0 },
    bestPatternsByMode: { drums: 0, notes: 0 },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SCORE_KEY) || "null");
    for (const key of Object.keys(scores))
      for (const gameMode of ["drums", "notes"])
        scores[key][gameMode] = Math.max(
          0,
          Math.floor(Number(saved?.[key]?.[gameMode]) || 0),
        );
  } catch (error) {}
  return scores;
}
const scores = readScores();
const bestByMode = scores.bestByMode;
const bestPatternsByMode = scores.bestPatternsByMode;
function saveScores() {
  try {
    localStorage.setItem(SCORE_KEY, JSON.stringify({ bestByMode, bestPatternsByMode }));
  } catch (error) {
    updateStatus("Meilleur score conservé pour cette session, mais le navigateur ne permet pas son enregistrement.");
  }
}
let mode = "drums";
let gameMode = "simon";
let audioContext;
let limiterContext;
let masterLimiter;
let sequence = [];
let inputIndex = 0;
let completedPatterns = 0;
let phase = "idle";
let tempo = 630;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function prefersReducedMotion() {
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}
function getMasterLimiter(ctx) {
  if (limiterContext !== ctx) {
    limiterContext = ctx;
    masterLimiter = ctx.createDynamicsCompressor();
    masterLimiter.threshold.value = -1;
    masterLimiter.knee.value = 0;
    masterLimiter.ratio.value = 20;
    masterLimiter.attack.value = 0.003;
    masterLimiter.release.value = 0.12;
    masterLimiter.connect(ctx.destination);
  }
  return masterLimiter;
}
function updateStatus(message) {
  statusLine.innerHTML = message;
}
function setPadsDisabled(disabled) {
  pads.forEach((pad) => (pad.disabled = disabled));
}
function setModeControlsDisabled(disabled) {
  modeButtons.forEach((button) => (button.disabled = disabled));
}
function updateRoundLabel() {
  if (gameMode === "pattern") {
    roundLabel.innerHTML =
      "Meilleurs motifs : <strong>" + bestPatternsByMode[mode] + "</strong>";
    return;
  }
  const unit = mode === "notes" ? "note" : "son";
  roundLabel.innerHTML =
    "Meilleure suite : <strong>" +
    bestByMode[mode] +
    "</strong> " +
    unit +
    (bestByMode[mode] > 1 ? "s" : "");
}
async function ensureAudioReady() {
  audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state !== "running") await audioContext.resume();
  if (audioContext.state !== "running")
    throw new Error("AudioContext did not enter running state");
}
function renderMode() {
  padSets[mode].forEach((info, id) => {
    const pad = pads[id];
    pad.querySelector(".glyph").textContent = info.glyph;
    pad.querySelector(".name").textContent = info.name;
    pad.setAttribute("aria-label", info.aria + " · raccourci clavier " + (id + 1));
  });
  soundModeButtons.forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode)),
  );
  gameModeButtons.forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.mode === gameMode),
    ),
  );
  updateRoundLabel();
  gameModeTitle.textContent =
    gameMode === "pattern" ? "Motif mystère" : "Séquence musicale";
  if (gameMode === "pattern") {
    howto.textContent =
      "Un nouveau motif de 4 " +
      (mode === "notes" ? "notes" : "sons") +
      " à chaque tour. Le tempo accélère progressivement.";
  } else {
    howto.textContent =
      mode === "notes"
        ? "Chaque tour ajoute une note. Une erreur termine la partie."
        : "Chaque tour ajoute un coup. Une erreur termine la partie.";
  }
  document
    .querySelector(".pads")
    .setAttribute(
      "aria-label",
      mode === "notes" ? "Pads de notes" : "Pads de percussion",
    );
}
function chooseMode(nextMode) {
  if (
    phase === "starting" ||
    phase === "playback" ||
    phase === "input" ||
    phase === "between"
  )
    return;
  mode = nextMode;
  phase = "idle";
  sequence = [];
  inputIndex = 0;
  completedPatterns = 0;
  setPadsDisabled(false);
  setModeControlsDisabled(false);
  startButton.disabled = false;
  startButton.textContent = "Lancer la partie";
  renderMode();
  const soundName = mode === "notes" ? "notes" : "sons";
  updateStatus(
    gameMode === "pattern"
      ? "Mode " +
          soundName +
          " choisi. Chaque tour propose un nouveau motif à reproduire."
      : mode === "notes"
        ? "Mode notes choisi. Écoute la suite, puis retrouve les notes dans l'ordre."
        : "Mode percussions choisi. Écoute la suite, puis retrouve les sons dans l'ordre.",
  );
}
function chooseGameMode(nextGameMode) {
  if (
    phase === "starting" ||
    phase === "playback" ||
    phase === "input" ||
    phase === "between"
  )
    return;
  gameMode = nextGameMode;
  phase = "idle";
  sequence = [];
  inputIndex = 0;
  completedPatterns = 0;
  setPadsDisabled(false);
  setModeControlsDisabled(false);
  startButton.disabled = false;
  startButton.textContent = "Lancer la partie";
  renderMode();
  updateStatus(
    gameMode === "pattern"
      ? "Motif mystère choisi. Écoute une phrase musicale, puis reproduis-la. Chaque tour propose un nouveau motif."
      : "Séquence musicale choisie. Écoute la suite, puis reproduis-la. Elle s'allongera à chaque tour.",
  );
}
modeButtons[0].dataset.mode = "drums";
modeButtons[1].dataset.mode = "notes";
soundModeButtons[0].dataset.mode = "drums";
soundModeButtons[1].dataset.mode = "notes";
gameModeButtons[0].dataset.mode = "simon";
gameModeButtons[1].dataset.mode = "pattern";
soundModeButtons.forEach((button) =>
  button.addEventListener("click", () => chooseMode(button.dataset.mode)),
);
gameModeButtons.forEach((button) =>
  button.addEventListener("click", () => chooseGameMode(button.dataset.mode)),
);

function makeSound(id, token = session.version()) {
  audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
  const ctx = audioContext;
  if (ctx.state === "running") {
    scheduleSound(id, ctx);
  } else {
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === "running" && session.current(token))
          scheduleSound(id, ctx);
      })
      .catch(() => {
        if (!session.current(token)) return;
        updateStatus(
          "Le son est suspendu par le navigateur. Clique sur « Lancer la partie » pour le réactiver.",
        );
      });
  }
}

function trackSound(node) {
  activeSounds.add(node);
  node.onended = () => activeSounds.delete(node);
  return node;
}
function scheduleSound(id, ctx) {
  const now = ctx.currentTime;
  const output = getMasterLimiter(ctx);
  if (mode === "notes") {
    const osc = trackSound(ctx.createOscillator()),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = noteFrequencies[id];
    filter.type = "lowpass";
    filter.frequency.value = 2600;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    osc.connect(filter).connect(gain).connect(output);
    osc.start(now);
    osc.stop(now + 0.35);
    return;
  }
  if (id === 0) {
    const osc = trackSound(ctx.createOscillator()),
      gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.13);
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain).connect(output);
    osc.start(now);
    osc.stop(now + 0.25);
  } else if (id === 2) {
    const duration = 0.09,
      buffer = ctx.createBuffer(
        1,
        Math.ceil(ctx.sampleRate * duration),
        ctx.sampleRate,
      );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = trackSound(ctx.createBufferSource()),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.value = 6500;
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(output);
    source.start(now);
  } else {
    const duration = id === 1 ? 0.16 : 0.11,
      buffer = ctx.createBuffer(
        1,
        Math.ceil(ctx.sampleRate * duration),
        ctx.sampleRate,
      );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = trackSound(ctx.createBufferSource()),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = id === 1 ? 1800 : 1200;
    filter.Q.value = id === 1 ? 0.7 : 0.45;
    gain.gain.setValueAtTime(id === 1 ? 0.45 : 0.33, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(output);
    source.start(now);
    if (id === 1) {
      const osc = trackSound(ctx.createOscillator()),
        tone = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 180;
      tone.gain.setValueAtTime(0.2, now);
      tone.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(tone).connect(output);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  }
}

async function flash(id, duration = 190, token = session.version()) {
  if (!session.current(token)) return;
  const pad = pads[id],
    version = ++flashVersions[id],
    showFlash = !prefersReducedMotion();
  if (showFlash) pad.classList.add("is-lit");
  makeSound(id, token);
  await wait(duration);
  if (showFlash && flashVersions[id] === version)
    pad.classList.remove("is-lit");
}

async function playSequence(token = session.version()) {
  if (!session.current(token) || phase !== "playback") return;
  setPadsDisabled(true);
  setModeControlsDisabled(true);
  startButton.disabled = true;
  startButton.textContent = "Écoute…";
  const unit = mode === "notes" ? "note" : "son";
  updateStatus(
    gameMode === "pattern"
      ? "Écoute bien le motif : <strong>" +
          sequence.length +
          " " +
          (sequence.length > 1 ? unit + "s" : unit) +
          "</strong>"
      : "Écoute bien : <strong>" +
          sequence.length +
          " " +
          (sequence.length > 1 ? unit + "s" : unit) +
          "</strong>",
  );
  await wait(450);
  for (const id of sequence) {
    if (!session.current(token) || phase !== "playback") return;
    await flash(id, 190, token);
    if (!session.current(token)) return;
    await wait(tempo - 190);
  }
  if (!session.current(token)) return;
  phase = "input";
  inputIndex = 0;
  setPadsDisabled(false);
  startButton.textContent = "À toi de jouer";
  updateStatus(
    gameMode === "pattern"
      ? "À toi : reproduis ce motif dans le même ordre."
      : "À toi : rejoue <strong>" +
          sequence.length +
          " " +
          (sequence.length > 1 ? unit + "s" : unit) +
          "</strong> dans le même ordre.",
  );
  if (
    keyboardGame &&
    (document.activeElement === document.body ||
      document.activeElement === startButton ||
      pads.includes(document.activeElement))
  )
    pads[0].focus();
}

function beginRound(token = session.version()) {
  if (!session.current(token)) return;
  phase = "playback";
  if (gameMode === "simon") {
    sequence.push(Math.floor(Math.random() * pads.length));
  } else {
    sequence = Array.from({ length: 4 }, () =>
      Math.floor(Math.random() * pads.length),
    );
  }
  void playSequence(token);
}

async function fail(token = session.version()) {
  if (!session.current(token)) return;
  phase = "over";
  setPadsDisabled(true);
  startButton.disabled = true;
  makeSound(1, token);
  await wait(85);
  if (!session.current(token)) return;
  makeSound(1, token);
  if (gameMode === "pattern") {
    updateStatus(
      "Fin de partie. Tu as reproduit <strong>" +
        completedPatterns +
        " " +
        (completedPatterns > 1 ? "motifs" : "motif") +
        "</strong> à la suite.",
    );
  } else {
    updateStatus(
      window.BeatLabCore.gameResult(Math.max(0, sequence.length - 1), mode),
    );
  }
  setPadsDisabled(false);
  setModeControlsDisabled(false);
  startButton.disabled = false;
  startButton.textContent = "Rejouer";
  stopButton.disabled = true;
  if (
    keyboardGame &&
    (document.activeElement === document.body ||
      document.activeElement === startButton ||
      pads.includes(document.activeElement))
  )
    startButton.focus();
}

function stopGame() {
  const returnFocus = document.activeElement === stopButton;
  session.begin();
  phase = "idle";
  sequence = [];
  inputIndex = 0;
  completedPatterns = 0;
  pads.forEach((pad, id) => {
    flashVersions[id]++;
    pad.classList.remove("is-lit");
  });
  activeSounds.forEach((sound) => {
    try {
      sound.stop();
    } catch (error) {}
  });
  activeSounds.clear();
  setPadsDisabled(false);
  setModeControlsDisabled(false);
  startButton.disabled = false;
  startButton.textContent = "Lancer la partie";
  stopButton.disabled = true;
  updateStatus(
    "Partie arrêtée. Tu peux changer de mode ou lancer une nouvelle partie.",
  );
  if (returnFocus) startButton.focus();
  keyboardGame = false;
}
stopButton.addEventListener("click", stopGame);

pads.forEach((pad, id) =>
  pad.addEventListener("click", async () => {
    const token = session.version();
    if (phase === "idle" || phase === "over") {
      try {
        await ensureAudioReady();
        if (session.current(token)) void flash(id, 120, token);
      } catch (error) {
        updateStatus(
          "Le son n’a pas démarré. Vérifie la sortie audio, puis réessaie.",
        );
      }
      return;
    }
    if (phase !== "input") return;
    const expected = sequence[inputIndex];
    void flash(id, 120, token);
    if (id !== expected) {
      void fail(token);
      return;
    }
    inputIndex++;
    if (inputIndex < sequence.length) return;
    phase = "between";
    if (gameMode === "pattern") {
      completedPatterns++;
      bestPatternsByMode[mode] = Math.max(
        bestPatternsByMode[mode],
        completedPatterns,
      );
      saveScores();
      updateStatus("Motif retrouvé ! Un nouveau motif arrive…");
      tempo = Math.max(360, 630 - Math.floor(completedPatterns / 3) * 40);
    } else {
      bestByMode[mode] = Math.max(bestByMode[mode], sequence.length);
      saveScores();
      updateStatus("Bien joué ! Le groove s'allonge…");
      tempo = Math.max(300, 630 - Math.floor(sequence.length / 4) * 45);
    }
    updateRoundLabel();
    await wait(700);
    if (session.current(token) && phase === "between") beginRound(token);
  }),
);

startButton.addEventListener("click", async (event) => {
  if (
    phase === "starting" ||
    phase === "playback" ||
    phase === "input" ||
    phase === "between"
  )
    return;
  const token = session.begin();
  keyboardGame = event.detail === 0;
  phase = "starting";
  startButton.disabled = true;
  stopButton.disabled = false;
  setModeControlsDisabled(true);
  setPadsDisabled(true);
  startButton.textContent = "Activation audio…";
  try {
    await ensureAudioReady();
    if (!session.current(token)) return;
  } catch (error) {
    if (!session.current(token)) return;
    phase = "idle";
    setPadsDisabled(false);
    setModeControlsDisabled(false);
    startButton.disabled = false;
    stopButton.disabled = true;
    startButton.textContent = "Réessayer";
    updateStatus(
      "Le son n’a pas démarré. Vérifie la sortie audio, puis réessaie.",
    );
    if (keyboardGame) startButton.focus();
    return;
  }
  sequence = [];
  inputIndex = 0;
  completedPatterns = 0;
  tempo = 630;
  beginRound(token);
});
renderMode();

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable='true']")
  )
    return;
  if (!/^[1-4]$/.test(event.key)) return;
  const pad = pads[Number(event.key) - 1];
  if (!pad || pad.disabled) return;
  event.preventDefault();
  pad.click();
});
