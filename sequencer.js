(() => {
  "use strict";
  const core = window.BeatLabCore,
    transport = core.latestOperation();
  let starting = false;
  const STATE_KEY = "beat-lab-sequencer-v2",
    DB_NAME = "beat-lab-local-audio",
    DB_STORE = "samples",
    STEP_COUNT = 32;
  const defs = [
    ["Kick", "#d8f36a"],
    ["Snare", "#ff8058"],
    ["Clap", "#bd91fa"],
    ["Charley fermé", "#76caff"],
    ["Percussion 1", "#f0bd62"],
    ["Percussion 2", "#ed8fc4"],
    ["Guitare / Texture 1", "#86d6a1"],
    ["Guitare / Texture 2", "#e5d87a"],
  ];
  const FX_RANGES = Object.freeze({
    filter: [500, 18000],
    drive: [0, 100],
    delay: [0, 100],
    reverb: [0, 100],
  });
  const clampFx = (key, value) =>
    Math.max(FX_RANGES[key][0], Math.min(FX_RANGES[key][1], value));
  function restoreFx(target, saved) {
    if (!saved) return;
    for (const key of Object.keys(FX_RANGES)) {
      const value = Number(saved[key]);
      if (Number.isFinite(value)) target[key] = clampFx(key, value);
    }
  }
  const tracks = defs.map((d, i) => ({
    id: "track-" + i,
    name: d[0],
    color: d[1],
    steps: Array(STEP_COUNT).fill(false),
    buffer: null,
    fileName: "",
    hasStoredSample: false,
    mix: { volume: 100, pan: 0 },
    mute: false,
    solo: false,
    fx: { filter: 18000, drive: 0, delay: 0, reverb: 0 },
    nodes: null,
  }));
  tracks.forEach((track) => {
    track.load = core.latestOperation();
    track.write = core.serialQueue();
    track.removing = false;
  });
  const $ = (s) => document.querySelector(s),
    grid = $("#grid"),
    tempo = $("#tempo"),
    bpm = $("#bpm"),
    length = $("#length"),
    swing = $("#swing"),
    play = $("#play"),
    status = $("#status"),
    persist = $("#persist"),
    lengthAnnouncement = $("#length-status"),
    cells = [];
  let dbPromise = null,
    ctx = null,
    master = null,
    masterLimiter = null,
    playing = false,
    step = 0,
    nextTime = 0,
    schedulerId = 0,
    saveId = 0;
  const activeSources = new Set(),
    paintTimers = new Set();
  let stepNavigation = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    if (!("indexedDB" in window)) {
      dbPromise = Promise.resolve(null);
      return dbPromise;
    }
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(DB_STORE))
            d.createObjectStore(DB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
    return dbPromise;
  }
  async function dbGet(key) {
    const d = await openDB();
    if (!d) return null;
    return new Promise((resolve) => {
      try {
        const r = d
          .transaction(DB_STORE, "readonly")
          .objectStore(DB_STORE)
          .get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }
  async function dbPut(key, value) {
    const d = await openDB();
    if (!d) throw Error("Le stockage local du navigateur est indisponible");
    return new Promise((resolve, reject) => {
      try {
        const tx = d.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error || Error("Enregistrement impossible"));
        tx.onabort = () => reject(tx.error || Error("Enregistrement annulé"));
      } catch (e) {
        reject(e);
      }
    });
  }
  async function dbDelete(key) {
    const d = await openDB();
    if (!d) throw Error("Stockage des samples indisponible");
    return new Promise((resolve, reject) => {
      try {
        const tx = d.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || Error("Suppression impossible"));
        tx.onabort = () => reject(tx.error || Error("Suppression annulée"));
      } catch (error) {
        reject(error);
      }
    });
  }
  function makeCurve(amount) {
    const n = 2048,
      curve = new Float32Array(n),
      k = (amount / 100) * 12;
    if (k === 0) {
      for (let i = 0; i < n; i++) curve[i] = (i * 2) / (n - 1) - 1;
      return curve;
    }
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }
  function makeImpulse(ac) {
    const seconds = 1.25,
      len = Math.floor(ac.sampleRate * seconds),
      b = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const a = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const fade = Math.pow(1 - i / len, 3.3);
        a[i] = (Math.random() * 2 - 1) * fade;
      }
    }
    return b;
  }
  function connectMasterLimiter(audioContext, input) {
    const limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    input.connect(limiter).connect(audioContext.destination);
    return limiter;
  }
  function ensureAudio() {
    if (ctx && ctx.state !== "closed") return ctx;
    if (ctx && ctx.state === "closed") {
      ctx = null;
      master = null;
      masterLimiter = null;
      tracks.forEach((track) => (track.nodes = null));
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw Error("Web Audio n’est pas disponible dans ce navigateur");
    ctx = new AC();
    ctx.addEventListener("statechange", () => {
      if ((playing || starting) && ctx && ctx.state !== "running") {
        stop();
        status.textContent =
          "Lecture arrêtée après une interruption audio · appuie sur Jouer pour reprendre.";
      }
    });
    master = ctx.createGain();
    master.gain.value = 0.78;
    masterLimiter = connectMasterLimiter(ctx, master);
    const impulse = makeImpulse(ctx),
      hasSolo = tracks.some((t) => t.solo);
    tracks.forEach((track) => {
      const filter = ctx.createBiquadFilter(),
        shape = ctx.createWaveShaper(),
        volume = ctx.createGain(),
        audibility = ctx.createGain(),
        panSplit = ctx.createChannelSplitter(2),
        panMerge = ctx.createChannelMerger(2),
        panMonoL = ctx.createGain(),
        panMonoR = ctx.createGain(),
        panLL = ctx.createGain(),
        panLR = ctx.createGain(),
        panRL = ctx.createGain(),
        panRR = ctx.createGain(),
        dry = ctx.createGain(),
        delay = ctx.createDelay(1.2),
        feedback = ctx.createGain(),
        delayWet = ctx.createGain(),
        convolver = ctx.createConvolver(),
        reverbWet = ctx.createGain();
      filter.type = "lowpass";
      filter.frequency.value = track.fx.filter;
      filter.Q.value = 0.65;
      shape.curve = makeCurve(track.fx.drive);
      shape.oversample = "2x";
      volume.gain.value = track.mix.volume / 100;
      audibility.gain.value = !track.mute && (!hasSolo || track.solo) ? 1 : 0;
      audibility.channelCount = 2;
      audibility.channelCountMode = "clamped-max";
      audibility.channelInterpretation = "speakers";
      dry.gain.value = 1;
      delay.delayTime.value = 0.28;
      feedback.gain.value = 0.18;
      delayWet.gain.value = 0;
      convolver.buffer = impulse;
      reverbWet.gain.value = 0;
      filter.connect(shape);
      shape.connect(volume);
      volume.connect(audibility);
      audibility.connect(panSplit);
      panSplit.connect(panMonoL, 0);
      panSplit.connect(panMonoR, 0);
      panSplit.connect(panLL, 0);
      panSplit.connect(panLR, 0);
      panSplit.connect(panRL, 1);
      panSplit.connect(panRR, 1);
      panMonoL.connect(panMerge, 0, 0);
      panMonoR.connect(panMerge, 0, 1);
      panLL.connect(panMerge, 0, 0);
      panLR.connect(panMerge, 0, 1);
      panRL.connect(panMerge, 0, 0);
      panRR.connect(panMerge, 0, 1);
      panMerge.connect(dry).connect(master);
      panMerge.connect(delay);
      delay.connect(feedback).connect(delay);
      delay.connect(delayWet).connect(master);
      panMerge.connect(convolver).connect(reverbWet).connect(master);
      track.nodes = {
        filter,
        shape,
        volume,
        audibility,
        panSplit,
        panMerge,
        panMonoL,
        panMonoR,
        panLL,
        panLR,
        panRL,
        panRR,
        delay,
        feedback,
        delayWet,
        reverbWet,
      };
      applyMix(track);
    });
    return ctx;
  }
  function applyMix(track) {
    if (!ctx || !track.nodes) return;
    const n = track.nodes;
    n.volume.gain.setTargetAtTime(
      Number(track.mix.volume) / 100,
      ctx.currentTime,
      0.015,
    );
    const x = (Math.max(-1, Math.min(1, Number(track.mix.pan) / 100)) + 1) / 2,
      isStereo = Boolean(track.buffer && track.buffer.numberOfChannels > 1);
    let panLL, panLR, panRL, panRR;
    if (x <= 0.5) {
      const t = x * 2;
      panLL = 1;
      panLR = 0;
      panRL = 1 - t;
      panRR = t;
    } else {
      const t = (x - 0.5) * 2;
      panLL = 1 - t;
      panLR = t;
      panRL = 0;
      panRR = 1;
    }
    const gains = {
      panMonoL: isStereo ? 0 : 1 - x,
      panMonoR: isStereo ? 0 : x,
      panLL: isStereo ? panLL : 0,
      panLR: isStereo ? panLR : 0,
      panRL: isStereo ? panRL : 0,
      panRR: isStereo ? panRR : 0,
    };
    Object.entries(gains).forEach(([key, value]) =>
      n[key].gain.setTargetAtTime(value, ctx.currentTime, 0.015),
    );
  }
  function applyTrackAudibility(track) {
    if (!ctx || !track.nodes) return;
    const hasSolo = tracks.some((t) => t.solo),
      audible = !track.mute && (!hasSolo || track.solo);
    track.nodes.audibility.gain.setTargetAtTime(
      audible ? 1 : 0,
      ctx.currentTime,
      0.008,
    );
  }
  function updateAudibility() {
    tracks.forEach(applyTrackAudibility);
  }
  function applyFx(track) {
    if (!ctx || !track.nodes) return;
    const n = track.nodes;
    n.filter.frequency.setTargetAtTime(
      Number(track.fx.filter),
      ctx.currentTime,
      0.015,
    );
    n.shape.curve = makeCurve(Number(track.fx.drive));
    const echo = Number(track.fx.delay) / 100,
      reverb = Number(track.fx.reverb) / 100;
    n.feedback.gain.setTargetAtTime(0.12 + echo * 0.48, ctx.currentTime, 0.02);
    n.delayWet.gain.setTargetAtTime(echo * 0.48, ctx.currentTime, 0.02);
    n.reverbWet.gain.setTargetAtTime(reverb * 0.42, ctx.currentTime, 0.025);
    applyMix(track);
    applyTrackAudibility(track);
  }
  function saveNow() {
    clearTimeout(saveId);
    saveId = 0;
    try {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          tempo: Number(tempo.value),
          length: Number(length.value),
          swing: swing.checked,
          tracks: tracks.map((t) => ({
            steps: t.steps,
            mix: t.mix,
            mute: t.mute,
            solo: t.solo,
            fx: t.fx,
          })),
        }),
      );
      if (persist.textContent.startsWith("Impossible de sauvegarder"))
        persist.textContent =
          "Samples et réglages conservés automatiquement sur cet appareil.";
    } catch (_) {
      persist.textContent =
        "Impossible de sauvegarder les réglages : le stockage local du navigateur est plein ou désactivé.";
    }
  }
  function saveState() {
    clearTimeout(saveId);
    saveId = setTimeout(saveNow, 100);
  }
  window.addEventListener("pagehide", saveNow);
  function updateLabel(track, label) {
    const name = label.querySelector(".filename");
    if (name) {
      name.textContent = track.fileName || "aucun sample";
      name.title = track.fileName || "aucun sample";
    }
    const remove = label.querySelector(".remove-sample");
    if (remove)
      remove.disabled = track.removing || !(track.buffer || track.hasStoredSample);
  }

  async function importSample(track, file) {
    if (track.removing) return;
    try {
      core.checkAudioFile(file);
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    const token = track.load.begin();
    stop();
    status.textContent = "Chargement de " + file.name + "…";
    let decoded;
    try {
      await core.checkAudioFileDuration(file);
      if (!track.load.current(token)) return;
      const ac = ensureAudio(),
        bytes = await file.arrayBuffer();
      if (!track.load.current(token)) return;
      decoded = await ac.decodeAudioData(bytes);
      if (!track.load.current(token)) return;
      if (decoded.duration > 120)
        throw new Error("La durée décodée dépasse la limite de 2 minutes.");
    } catch (error) {
      if (track.load.current(token))
        status.textContent =
          error.message || "Sample illisible ; le sample précédent est conservé.";
      return;
    }
    try {
      await track.write(() => {
        if (track.load.current(token))
          return dbPut(track.id, {
            blob: file,
            name: file.name,
            type: file.type || "audio/wav",
          });
      });
    } catch (error) {
      if (!track.load.current(token)) return;
      status.textContent =
        "Enregistrement impossible ; le sample précédent est conservé.";
      persist.textContent =
        "Le navigateur n’a pas pu enregistrer ce sample. Le précédent est conservé.";
      return;
    }
    if (!track.load.current(token)) return;
    track.buffer = decoded;
    track.fileName = file.name;
    track.hasStoredSample = true;
    applyFx(track);
    updateLabel(track, track._label);
    status.textContent = "Sample chargé et sauvegardé";
    persist.textContent =
      "Samples et réglages conservés automatiquement sur cet appareil.";
  }
  async function removeSample(track) {
    if (track.removing) return;
    track.load.begin();
    track.removing = true;
    track._input.disabled = true;
    updateLabel(track, track._label);
    stop();
    try {
      await track.write(() => dbDelete(track.id));
      track.buffer = null;
      track.fileName = "";
      track.hasStoredSample = false;
      track._input.value = "";
      status.textContent = "Sample retiré de " + track.name;
      saveState();
    } catch (error) {
      persist.textContent =
        "Suppression impossible dans le stockage du navigateur. Le sample est conservé ; réessaie.";
      status.textContent = "Sample non supprimé";
    } finally {
      track.removing = false;
      track._input.disabled = false;
      updateLabel(track, track._label);
    }
  }
  async function restoreSample(track, entry, token) {
    if (!entry || !track.load.current(token)) return false;
    track.hasStoredSample = true;
    try {
      if (!entry.blob) throw Error("Le fichier sauvegardé est incomplet.");
      core.checkAudioFile(entry.blob);
      await core.checkAudioFileDuration(entry.blob);
      if (!track.load.current(token)) return false;
      const ac = ensureAudio(),
        bytes = await entry.blob.arrayBuffer();
      if (!track.load.current(token)) return false;
      const decoded = await ac.decodeAudioData(bytes);
      if (!track.load.current(token)) return false;
      if (decoded.duration > 120) throw new Error("Sample trop long");
      track.buffer = decoded;
      track.fileName = entry.name || "sample sauvegardé";
      updateLabel(track, track._label);
      applyFx(track);
      return true;
    } catch (error) {
      if (track.load.current(token)) {
        track.fileName = (entry.name || "sample") + " · impossible à restaurer";
        updateLabel(track, track._label);
      }
      return false;
    }
  }
  function stepAccessibleLabel(trackIndex, stepIndex, visibleSteps) {
    const track = tracks[trackIndex];
    const active = Boolean(track.steps[stepIndex]);
    return `${track.name}, piste ${trackIndex + 1} sur ${tracks.length}, pas ${stepIndex + 1} sur ${visibleSteps}, ${active ? "activé" : "désactivé"}`;
  }
  function drawSteps() {
    const visibleSteps = Number(length.value) || 16;
    grid.style.setProperty("--step-count", visibleSteps);
    grid.setAttribute(
      "aria-label",
      `Grille de séquençage, ${visibleSteps} pas par piste`,
    );
    headCells.forEach((cell, si) =>
      cell.classList.toggle("beyond", si >= visibleSteps),
    );
    cells.forEach((row, ti) =>
      row.forEach((b, si) => {
        const on = tracks[ti].steps[si];
        b.classList.toggle("on", on);
        b.classList.toggle("beyond", si >= visibleSteps);
        b.setAttribute("aria-pressed", String(on));
        b.setAttribute("aria-label", stepAccessibleLabel(ti, si, visibleSteps));
      }),
    );
    if (stepNavigation) stepNavigation.sync();
  }
  function updateFxSlider(range) {
    const min = Number(range.min),
      max = Number(range.max),
      ratio = (Number(range.value) - min) / (max - min),
      progress = Math.max(0, Math.min(100, ratio * 100));
    range.style.setProperty("--fx-progress", progress + "%");
  }
  function setFxValue(track, key, value, output) {
    track.fx[key] = clampFx(key, Number(value));
    output.textContent =
      key === "filter"
        ? Number(value) >= 1000
          ? (Number(value) / 1000).toFixed(Number(value) >= 10000 ? 0 : 1) +
            " kHz"
          : value + " Hz"
        : value + "%";
    applyFx(track);
    saveState();
  }
  function updateMixSlider(range, key, value) {
    const ratio =
        (Number(value) - Number(range.min)) /
        (Number(range.max) - Number(range.min)),
      position = Math.max(0, Math.min(100, ratio * 100));
    range.style.setProperty(
      "--mix-fill-start",
      (key === "pan" ? Math.min(position, 50) : 0) + "%",
    );
    range.style.setProperty(
      "--mix-fill-end",
      (key === "pan" ? Math.max(position, 50) : position) + "%",
    );
  }
  function formatPercent(value) {
    return Math.round(Number(value)) + "%";
  }
  function formatPan(value) {
    const n = Number(value);
    return n === 0
      ? "Centre"
      : (n < 0 ? "G " : "D ") + formatPercent(Math.abs(n));
  }
  function setMixValue(track, key, value, output) {
    track.mix[key] = Number(value);
    output.textContent =
      key === "volume" ? formatPercent(value) : formatPan(value);
    track["_" + key].range.setAttribute("aria-valuetext", output.textContent);
    applyMix(track);
    saveState();
  }
  function syncTrackToggles(track) {
    [
      ["mute", track._muteButton],
      ["solo", track._soloButton],
    ].forEach(([key, button]) => {
      if (!button) return;
      button.classList.toggle("is-active", track[key]);
      button.setAttribute("aria-pressed", String(track[key]));
    });
  }
  const head = document.createElement("div");
  head.className = "head";
  head.innerHTML =
    "<div>Piste / Sample / Mixage / Effets</div>" +
    Array.from(
      { length: STEP_COUNT },
      (_, i) => "<div>" + String(i + 1).padStart(2, "0") + "</div>",
    ).join("");
  grid.append(head);
  const headCells = [...head.children].slice(1);
  tracks.forEach((track, ti) => {
    const row = document.createElement("div");
    row.className = "track";
    row.style.setProperty("--tone", track.color);
    const label = document.createElement("div");
    label.className = "tracklabel";
    const title = document.createElement("div");
    title.className = "trackname";
    title.textContent = String(ti + 1).padStart(2, "0") + " · " + track.name;
    const trackinfo = document.createElement("div");
    trackinfo.className = "trackinfo";
    trackinfo.append(title);
    const cue = document.createElement("span");
    cue.className = "track-cue";
    cue.textContent = title.textContent;
    cue.setAttribute("aria-hidden", "true");
    row.append(cue);
    const sampleline = document.createElement("div");
    sampleline.className = "sampleline";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.setAttribute("aria-label", "Charger un sample pour " + track.name);
    const filename = document.createElement("span");
    filename.className = "filename";
    filename.textContent = "aucun sample";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn small remove-sample";
    remove.textContent = "Retirer";
    remove.disabled = true;
    remove.setAttribute("aria-label", "Retirer le sample de " + track.name);
    sampleline.append(input, filename, remove);
    trackinfo.append(sampleline);
    label.append(trackinfo);
    const mixpanel = document.createElement("div");
    mixpanel.className = "trackmix";
    mixpanel.setAttribute("role", "group");
    mixpanel.setAttribute("aria-label", "Mixage · " + track.name);
    const toggles = document.createElement("div");
    toggles.className = "tracktoggles";
    const muteButton = document.createElement("button"),
      soloButton = document.createElement("button");
    [
      [muteButton, "mute", "Mute"],
      [soloButton, "solo", "Solo"],
    ].forEach(([button, key, text]) => {
      button.type = "button";
      button.className = "track-toggle " + key;
      button.textContent = text;
      button.setAttribute("aria-label", text + " · " + track.name);
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        track[key] = !track[key];
        syncTrackToggles(track);
        updateAudibility();
        saveState();
        status.textContent =
          track.name + " · " + text + (track[key] ? " activé" : " désactivé");
      });
    });
    track._muteButton = muteButton;
    track._soloButton = soloButton;
    toggles.append(muteButton, soloButton);
    mixpanel.append(toggles);
    const mixcontrols = document.createElement("div");
    mixcontrols.className = "mixcontrols";
    [
      ["volume", "Volume", 0, 100, 100, 0.01],
      ["pan", "Panoramique", -100, 100, 0, 0.01],
    ].forEach(([key, name, min, max, def, inc]) => {
      const wrap = document.createElement("div");
      wrap.className = "mixcontrol" + (key === "pan" ? " pan-control" : "");
      const titleText = document.createElement("span"),
        out = document.createElement("output"),
        range = document.createElement("input");
      titleText.textContent = key === "pan" ? "Pan" : name;
      titleText.title = name;
      out.textContent = key === "volume" ? "100%" : "Centre";
      range.type = "range";
      range.min = String(min);
      range.max = String(max);
      range.step = String(inc);
      range.value = String(track.mix[key] ?? def);
      updateMixSlider(range, key, range.value);
      range.setAttribute(
        "aria-label",
        (key === "pan" ? "Panoramique" : name) + " · " + track.name,
      );
      range.setAttribute(
        "aria-valuetext",
        key === "pan" ? formatPan(range.value) : formatPercent(range.value),
      );
      range.addEventListener("keydown", (event) => {
        const direction = ["ArrowRight", "ArrowUp"].includes(event.key)
          ? 1
          : ["ArrowLeft", "ArrowDown"].includes(event.key)
            ? -1
            : 0;
        if (!direction) return;
        event.preventDefault();
        range.value = String(
          Math.max(
            min,
            Math.min(
              max,
              Math.round(Number(range.value)) +
                direction * (event.shiftKey ? 10 : 1),
            ),
          ),
        );
        updateMixSlider(range, key, range.value);
        setMixValue(track, key, range.value, out);
      });
      range.addEventListener("input", () => {
        updateMixSlider(range, key, range.value);
        setMixValue(track, key, range.value, out);
      });
      if (key === "pan") {
        titleText.className = "pan-title";
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "pan-reset";
        reset.textContent = "↺";
        reset.title = "Remettre la panoramique au centre";
        reset.setAttribute(
          "aria-label",
          "Centrer la panoramique · " + track.name,
        );
        reset.addEventListener("click", () => {
          range.value = "0";
          updateMixSlider(range, "pan", range.value);
          setMixValue(track, "pan", 0, out);
          range.focus();
          status.textContent = "Panoramique centrée · " + track.name;
        });
        titleText.append(reset);
      }
      wrap.append(titleText, range, out);
      mixcontrols.append(wrap);
      track["_" + key] = { range, out };
    });
    mixpanel.append(mixcontrols);
    label.append(mixpanel);
    const details = document.createElement("details");
    details.className = "fx";
    const summary = document.createElement("summary");
    summary.textContent = "FX · filtre / saturation / écho / réverb";
    details.append(summary);
    const fxgrid = document.createElement("div");
    fxgrid.className = "fxgrid";
    const fxDefs = [
      ["filter", "Filtre", 500, 18000, 18000, 100],
      ["drive", "Saturation", 0, 100, 0, 1],
      ["delay", "Écho", 0, 100, 0, 1],
      ["reverb", "Reverb", 0, 100, 0, 1],
    ];
    fxDefs.forEach(([key, name, min, max, def, inc]) => {
      const wrap = document.createElement("label");
      wrap.className = "fxcontrol";
      const line = document.createElement("span"),
        titleText = document.createElement("span"),
        out = document.createElement("output"),
        range = document.createElement("input");
      titleText.textContent = name;
      out.textContent = key === "filter" ? "18 kHz" : "0%";
      line.append(titleText, out);
      range.type = "range";
      range.min = String(min);
      range.max = String(max);
      range.step = String(inc);
      range.value = String(def);
      updateFxSlider(range);
      range.setAttribute("aria-label", name + " · " + track.name);
      range.addEventListener("input", () => {
        updateFxSlider(range);
        setFxValue(track, key, range.value, out);
      });
      wrap.append(line, range);
      fxgrid.append(wrap);
      track["_" + key] = { range, out };
    });
    details.append(fxgrid);
    label.append(details);
    row.append(label);
    cells[ti] = [];
    const stepRow = document.createElement("div");
    stepRow.className = "step-row";
    row.append(stepRow);
    track.steps.forEach((on, si) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.step = String(si + 1);
      b.className =
        "pad" +
        (si % 4 === 0 && si > 0 ? " measure" : "") +
        (si >= Number(length.value) ? " beyond" : "");
      b.setAttribute(
        "aria-label",
        stepAccessibleLabel(ti, si, Number(length.value) || 16),
      );
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        track.steps[si] = !track.steps[si];
        b.classList.toggle("on", track.steps[si]);
        b.setAttribute("aria-pressed", String(track.steps[si]));
        b.setAttribute(
          "aria-label",
          stepAccessibleLabel(ti, si, Number(length.value) || 16),
        );
        saveState();
      });
      cells[ti].push(b);
      stepRow.append(b);
    });
    grid.append(row);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) void importSample(track, file);
    });
    remove.addEventListener("click", () => {
      if (
        (track.buffer || track.hasStoredSample) &&
        window.confirm(`Retirer le sample « ${track.fileName || track.name} » ?`)
      )
        void removeSample(track);
    });
    track._label = label;
    track._input = input;
  });
  stepNavigation = window.BeatLabGrid(cells, () => Number(length.value));
  function paintPlayhead(n) {
    cells.forEach((row) => row.forEach((b) => b.classList.remove("current")));
    cells.forEach((row) => row[n].classList.add("current"));
  }
  function trigger(track, time) {
    if (!track.buffer || !ctx || !track.nodes) return;
    const src = ctx.createBufferSource();
    src.buffer = track.buffer;
    src.connect(track.nodes.filter);
    src.onended = () => activeSources.delete(src);
    activeSources.add(src);
    try {
      src.start(time);
    } catch (_) {
      activeSources.delete(src);
    }
  }
  function scheduler() {
    if (!playing || !ctx) return;
    while (nextTime < ctx.currentTime + 0.14) {
      const limit = Number(length.value);
      if (step >= limit) step = 0;
      const n = step;
      tracks.forEach((t) => {
        if (t.steps[n]) trigger(t, nextTime);
      });
      const delay = Math.max(0, (nextTime - ctx.currentTime) * 1000);
      const id = setTimeout(() => {
        paintTimers.delete(id);
        if (playing) paintPlayhead(n);
      }, delay);
      paintTimers.add(id);
      nextTime += core.stepDuration(tempo.value, n, swing.checked);
      step = (n + 1) % limit;
    }
  }
  async function start() {
    if (playing || starting) return;
    if (!tracks.some((t) => t.buffer)) {
      status.textContent = "Charge au moins un sample pour commencer";
      return;
    }
    const token = transport.begin();
    starting = true;
    play.disabled = true;
    play.textContent = "Activation audio…";
    try {
      const ac = ensureAudio();
      await ac.resume();
      if (!transport.current(token)) return;
      playing = true;
      step = 0;
      nextTime = ac.currentTime + 0.04;
      play.textContent = "■ Arrêter";
      status.textContent = "En lecture";
      schedulerId = setInterval(scheduler, 20);
    } catch (error) {
      if (transport.current(token)) {
        play.textContent = "▶ Jouer";
        status.textContent = "Audio indisponible : " + error.message;
      }
    } finally {
      if (transport.current(token)) {
        starting = false;
        play.disabled = false;
      }
    }
  }
  function stop() {
    transport.begin();
    starting = false;
    play.disabled = false;
    playing = false;
    clearInterval(schedulerId);
    schedulerId = 0;
    activeSources.forEach((s) => {
      try {
        s.stop();
      } catch (_) {}
    });
    activeSources.clear();
    paintTimers.forEach(clearTimeout);
    paintTimers.clear();
    cells.forEach((row) => row.forEach((b) => b.classList.remove("current")));
    play.textContent = "▶ Jouer";
    if (status && status.textContent === "En lecture")
      status.textContent = "À l’arrêt";
  }
  play.addEventListener("click", () => (playing ? stop() : start()));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (playing || starting)) {
      stop();
      status.textContent = "Lecture arrêtée quand l’onglet passe en arrière-plan.";
    }
  });
  $("#clear").addEventListener("click", () => {
    if (!window.confirm("Effacer les pas des huit pistes ?")) return;
    tracks.forEach((t) => t.steps.fill(false));
    drawSteps();
    saveState();
    status.textContent =
      "Motif effacé · samples, mixage, Mute, Solo et effets conservés";
  });
  tempo.addEventListener("input", () => {
    bpm.textContent = tempo.value;
    saveState();
  });
  length.addEventListener("change", () => {
    drawSteps();
    if (lengthAnnouncement)
      lengthAnnouncement.textContent =
        `La grille comporte maintenant ${Number(length.value)} pas par piste.`;
    saveState();
  });
  swing.addEventListener("change", saveState);
  async function restore() {
    const versions = tracks.map((t) => t.load.version());
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {};
    } catch (_) {
      saved = {};
    }
    if (saved.tempo)
      tempo.value = String(
        Math.max(60, Math.min(160, Number(saved.tempo) || 100)),
      );
    bpm.textContent = tempo.value;
    if ([8, 16].includes(Number(saved.length)))
      length.value = String(saved.length);
    swing.checked = Boolean(saved.swing);
    if (Array.isArray(saved.tracks))
      saved.tracks.forEach((item, i) => {
        if (!tracks[i] || !item) return;
        if (Array.isArray(item.steps))
          tracks[i].steps = Array.from({ length: STEP_COUNT }, (_, n) =>
            Boolean(item.steps[n]),
          );
        tracks[i].mute = Boolean(item.mute);
        tracks[i].solo = Boolean(item.solo);
        if (item.mix) {
          if (Number.isFinite(Number(item.mix.volume)))
            tracks[i].mix.volume = Math.max(
              0,
              Math.min(100, Number(item.mix.volume)),
            );
          if (Number.isFinite(Number(item.mix.pan)))
            tracks[i].mix.pan = Math.max(
              -100,
              Math.min(100, Number(item.mix.pan)),
            );
        }
        restoreFx(tracks[i].fx, item.fx);
      });
    drawSteps();
    tracks.forEach((t) => {
      syncTrackToggles(t);
      ["volume", "pan"].forEach((k) => {
        const control = t["_" + k];
        if (control) {
          control.range.value = String(t.mix[k]);
          updateMixSlider(control.range, k, t.mix[k]);
          control.out.textContent =
            k === "volume" ? formatPercent(t.mix.volume) : formatPan(t.mix.pan);
          control.range.setAttribute("aria-valuetext", control.out.textContent);
        }
      });
      ["filter", "drive", "delay", "reverb"].forEach((k) => {
        const control = t["_" + k];
        if (!control) return;
        control.range.value = String(t.fx[k]);
        updateFxSlider(control.range);
        control.out.textContent =
          k === "filter"
            ? t.fx[k] >= 1000
              ? (t.fx[k] / 1000).toFixed(t.fx[k] >= 10000 ? 0 : 1) + " kHz"
              : t.fx[k] + " Hz"
            : t.fx[k] + "%";
      });
    });
    let db = await openDB();
    if (!db) {
      if (tracks.some((t, i) => t.load.version() !== versions[i])) return;
      persist.textContent =
        "IndexedDB indisponible : les réglages sont mémorisés, mais les samples ne peuvent pas être conservés entre les pages.";
      status.textContent = "Stockage des samples indisponible";
      return;
    }
    const entries = await Promise.all(tracks.map((t) => dbGet(t.id)));
    const results = await Promise.all(
      tracks.map((t, i) => restoreSample(t, entries[i], versions[i])),
    );
    if (tracks.some((t, i) => t.load.version() !== versions[i])) return;
    const restored = results.filter(Boolean).length;
    persist.textContent =
      "Samples et réglages enregistrés localement dans ce navigateur.";
    status.textContent = restored
      ? restored + " sample(s) restauré(s) automatiquement"
      : "Prêt · charge des samples pour commencer";
  }
  restore().catch((e) => {
    if (tracks.some((t) => t.load.version() > 0)) return;
    persist.textContent =
      "Le stockage local a rencontré une erreur; les fichiers choisis resteront disponibles pour cette session.";
    status.textContent = "Prêt · " + e.message;
  });
})();
