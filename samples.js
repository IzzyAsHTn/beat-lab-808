(() => {
  const fileInput = document.querySelector("#file"),
    drop = document.querySelector("#drop"),
    canvas = document.querySelector("#wave"),
    g = canvas.getContext("2d"),
    startInput = document.querySelector("#start"),
    endInput = document.querySelector("#end"),
    playButton = document.querySelector("#play"),
    stopButton = document.querySelector("#stop"),
    exportButton = document.querySelector("#export"),
    resetButton = document.querySelector("#reset"),
    testButton = document.querySelector("#test"),
    gainInput = document.querySelector("#gain"),
    gainValue = document.querySelector("#gain-value"),
    filename = document.querySelector("#filename"),
    meta = document.querySelector("#meta"),
    position = document.querySelector("#position"),
    message = document.querySelector("#message");
  let audioContext = null,
    buffer = null,
    waveBase = null,
    waveAccent = null,
    fileUrl = null,
    selectionStart = 0,
    selectionEnd = 0,
    dragAnchor = null,
    raf = 0;
  const fileLoad = window.BeatLabCore.latestOperation();
  const media = new Audio();
  media.preload = "auto";
  const duration = () => (buffer ? buffer.duration : 0);
  const timeText = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(3).padStart(6, "0")}`;
  function ensureAudio() {
    audioContext =
      audioContext || new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
  }
  function buildWaveCaches() {
    waveBase = waveAccent = null;
    if (!buffer) return;
    const dpr = window.devicePixelRatio || 1,
      W = canvas.width / dpr,
      H = canvas.height / dpr,
      channels = Math.min(2, buffer.numberOfChannels),
      lane = H / channels,
      caches = [];
    for (const color of ["#65736d", "#d8f36a"]) {
      const c = document.createElement("canvas");
      c.width = canvas.width;
      c.height = canvas.height;
      const x = c.getContext("2d");
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.strokeStyle = color;
      x.lineWidth = 1;
      for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch),
          mid = lane * (ch + 0.5),
          amp = lane * 0.42;
        x.beginPath();
        for (let px = 0; px < W; px++) {
          const a = Math.floor((px / W) * data.length),
            b = Math.max(a + 1, Math.floor(((px + 1) / W) * data.length));
          let lo = 1,
            hi = -1;
          for (let j = a; j < b && j < data.length; j++) {
            const v = data[j];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          x.moveTo(px + 0.5, mid - hi * amp);
          x.lineTo(px + 0.5, mid - lo * amp);
        }
        x.stroke();
      }
      caches.push(c);
    }
    waveBase = caches[0];
    waveAccent = caches[1];
  }
  function draw(playhead = null) {
    const dpr = window.devicePixelRatio || 1,
      W = canvas.width / dpr,
      H = canvas.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#141411";
    g.fillRect(0, 0, W, H);
    if (!buffer) {
      g.strokeStyle = "#393932";
      g.beginPath();
      g.moveTo(0, H / 2);
      g.lineTo(W, H / 2);
      g.stroke();
      g.fillStyle = "#bcbcaf";
      g.font = "13px sans-serif";
      g.textAlign = "center";
      g.fillText("La forme d’onde apparaîtra ici", W / 2, H / 2 - 14);
      return;
    }
    const sx = (selectionStart / duration()) * W,
      ex = (selectionEnd / duration()) * W;
    if (waveBase) g.drawImage(waveBase, 0, 0, W, H);
    if (waveAccent && ex > sx) {
      g.save();
      g.beginPath();
      g.rect(sx, 0, ex - sx, H);
      g.clip();
      g.drawImage(waveAccent, 0, 0, W, H);
      g.restore();
    }
    g.fillStyle = "#c5bfaa33";
    g.fillRect(0, 0, sx, H);
    g.fillRect(ex, 0, W - ex, H);
    g.strokeStyle = "#d8f36a";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(sx, 0);
    g.lineTo(sx, H);
    g.moveTo(ex, 0);
    g.lineTo(ex, H);
    g.stroke();
    if (playhead !== null) {
      g.strokeStyle = "#ff8058";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo((playhead / duration()) * W, 0);
      g.lineTo((playhead / duration()) * W, H);
      g.stroke();
    }
  }
  function fitCanvas() {
    const r = canvas.getBoundingClientRect(),
      d = window.devicePixelRatio || 1,
      w = Math.max(1, Math.round(r.width * d)),
      h = Math.max(1, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    buildWaveCaches();
    draw();
  }
  function setSelection(a, b) {
    if (!buffer) return;
    const min = 0.005;
    let lo = Math.max(0, Math.min(a, b)),
      hi = Math.min(duration(), Math.max(a, b));
    if (hi - lo < min) {
      if (lo + min <= duration()) hi = lo + min;
      else {
        hi = duration();
        lo = Math.max(0, hi - min);
      }
    }
    selectionStart = lo;
    selectionEnd = hi;
    startInput.value = lo.toFixed(3);
    endInput.value = hi.toFixed(3);
    draw();
  }
  function enable(on) {
    [
      startInput,
      endInput,
      playButton,
      stopButton,
      exportButton,
      resetButton,
    ].forEach((el) => (el.disabled = !on));
  }
  function stop() {
    media.pause();
    try {
      media.currentTime = selectionStart;
    } catch (e) {}
    cancelAnimationFrame(raf);
    position.textContent = timeText(selectionStart);
    draw();
  }
  async function loadFile(file) {
    if (!file) return;
    try {
      window.BeatLabCore.checkAudioFile(file);
    } catch (error) {
      message.textContent = error.message;
      return;
    }
    const token = fileLoad.begin();
    stop();
    enable(false);
    message.textContent = "Chargement du fichier…";
    let pendingUrl = null;
    try {
      await window.BeatLabCore.checkAudioFileDuration(file);
      if (!fileLoad.current(token)) return;
      const bytes = await file.arrayBuffer();
      if (!fileLoad.current(token)) return;
      const decoded = await ensureAudio().decodeAudioData(bytes.slice(0));
      if (!fileLoad.current(token)) return;
      if (decoded.duration > 120)
        throw new Error("La durée décodée dépasse la limite de 2 minutes.");
      pendingUrl = URL.createObjectURL(file);
      // Separate metadata loading keeps an older file from changing the active player.
      const probe = new Audio();
      probe.preload = "metadata";
      try {
        await new Promise((resolve, reject) => {
          probe.addEventListener("loadedmetadata", resolve, { once: true });
          probe.addEventListener("error", reject, { once: true });
          probe.src = pendingUrl;
          probe.load();
        });
      } finally {
        probe.pause();
        probe.removeAttribute("src");
        probe.load();
      }
      if (!fileLoad.current(token)) return;
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = pendingUrl;
      pendingUrl = null;
      buffer = decoded;
      media.src = fileUrl;
      media.load();
      selectionStart = 0;
      selectionEnd = buffer.duration;
      startInput.max = buffer.duration;
      endInput.max = buffer.duration;
      filename.textContent = file.name;
      meta.textContent = `${buffer.numberOfChannels} ch · ${buffer.sampleRate} Hz · ${timeText(buffer.duration)}`;
      enable(true);
      fitCanvas();
      setSelection(0, buffer.duration);
      message.textContent =
        "Prêt. Fais glisser sur la forme d’onde pour choisir ton extrait.";
    } catch (error) {
      if (!fileLoad.current(token)) return;
      enable(Boolean(buffer));
      message.textContent =
        (error.message || "Ce format ne se décode pas ici. Essaie un WAV ou MP3.") +
        (buffer ? " L’ancien fichier reste chargé." : "");
    } finally {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    }
  }
  async function play() {
    if (!buffer || !fileUrl) return;
    stop();
    try {
      media.volume = Number(gainInput.value) / 100;
      media.currentTime = selectionStart;
      await media.play();
      message.textContent = "Lecture par le lecteur audio du navigateur.";
      const tick = () => {
        if (media.paused) return;
        const t = media.currentTime;
        if (t >= selectionEnd) {
          stop();
          position.textContent = timeText(selectionEnd);
          draw(selectionEnd);
          return;
        }
        position.textContent = timeText(t);
        draw(t);
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      message.textContent =
        "Lecture bloquée par le navigateur. Ouvre cette page dans Safari ou Chrome puis réessaie.";
    }
  }
  function makeTestTone() {
    const rate = 22050,
      frames = Math.floor(rate * 0.7),
      dataBytes = frames * 2,
      out = new ArrayBuffer(44 + dataBytes),
      v = new DataView(out);
    let p = 0;
    const put = (s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i));
    };
    put("RIFF");
    v.setUint32(p, 36 + dataBytes, true);
    p += 4;
    put("WAVE");
    put("fmt ");
    v.setUint32(p, 16, true);
    p += 4;
    v.setUint16(p, 1, true);
    p += 2;
    v.setUint16(p, 1, true);
    p += 2;
    v.setUint32(p, rate, true);
    p += 4;
    v.setUint32(p, rate * 2, true);
    p += 4;
    v.setUint16(p, 2, true);
    p += 2;
    v.setUint16(p, 16, true);
    p += 2;
    put("data");
    v.setUint32(p, dataBytes, true);
    p += 4;
    for (let i = 0; i < frames; i++) {
      const fade = Math.min(1, i / (rate * 0.02), (frames - i) / (rate * 0.06)),
        sample =
          Math.sin((2 * Math.PI * 880 * i) / rate) * 0.55 * Math.max(0, fade);
      v.setInt16(p, sample < 0 ? sample * 32768 : sample * 32767, true);
      p += 2;
    }
    return new Blob([out], { type: "audio/wav" });
  }
  async function testOutput() {
    stop();
    try {
      const url = URL.createObjectURL(makeTestTone()),
        tone = new Audio(url);
      tone.volume = Number(gainInput.value) / 100;
      tone.onended = () => URL.revokeObjectURL(url);
      await tone.play();
      message.textContent =
        "Bip test envoyé par le lecteur audio natif. Si tu ne l’entends pas, vérifie la sortie ou le volume système.";
    } catch (e) {
      message.textContent =
        "Test audio bloqué. Ouvre le fichier dans Safari ou Chrome puis réessaie.";
    }
  }
  function exportWav() {
    if (!buffer) return;
    const from = Math.floor(selectionStart * buffer.sampleRate),
      to = Math.min(buffer.length, Math.ceil(selectionEnd * buffer.sampleRate)),
      frames = Math.max(1, to - from),
      channels = Math.min(2, buffer.numberOfChannels),
      bytes = frames * channels * 2,
      out = new ArrayBuffer(44 + bytes),
      v = new DataView(out);
    let p = 0;
    const text = (s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i));
    };
    text("RIFF");
    v.setUint32(p, 36 + bytes, true);
    p += 4;
    text("WAVE");
    text("fmt ");
    v.setUint32(p, 16, true);
    p += 4;
    v.setUint16(p, 1, true);
    p += 2;
    v.setUint16(p, channels, true);
    p += 2;
    v.setUint32(p, buffer.sampleRate, true);
    p += 4;
    v.setUint32(p, buffer.sampleRate * channels * 2, true);
    p += 4;
    v.setUint16(p, channels * 2, true);
    p += 2;
    v.setUint16(p, 16, true);
    p += 2;
    text("data");
    v.setUint32(p, bytes, true);
    p += 4;
    const data = Array.from({ length: channels }, (_, ch) =>
      buffer.getChannelData(ch),
    );
    for (let i = 0; i < frames; i++)
      for (let ch = 0; ch < channels; ch++) {
        const s = Math.max(-1, Math.min(1, data[ch][from + i] || 0));
        v.setInt16(p, s < 0 ? s * 32768 : s * 32767, true);
        p += 2;
      }
    const blob = new Blob([out], { type: "audio/wav" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a"),
      base = (filename.textContent.replace(/\.[^.]+$/, "") || "sample").replace(
        /[^a-z0-9_-]+/gi,
        "-",
      );
    a.href = url;
    a.download = `${base}-${selectionStart.toFixed(2)}s-${selectionEnd.toFixed(2)}s.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = "WAV exporté. Tu peux l’importer dans Logic Pro.";
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (!buffer) return;
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect();
    dragAnchor = Math.max(
      0,
      Math.min(duration(), ((e.clientX - r.left) / r.width) * duration()),
    );
    setSelection(dragAnchor, dragAnchor + 0.01);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragAnchor === null || !buffer) return;
    const r = canvas.getBoundingClientRect(),
      t = Math.max(
        0,
        Math.min(duration(), ((e.clientX - r.left) / r.width) * duration()),
      );
    setSelection(dragAnchor, t);
  });
  canvas.addEventListener("pointerup", () => (dragAnchor = null));
  canvas.addEventListener("pointercancel", () => (dragAnchor = null));
  startInput.addEventListener("change", () =>
    setSelection(Number(startInput.value) || 0, selectionEnd),
  );
  endInput.addEventListener("change", () =>
    setSelection(selectionStart, Number(endInput.value) || 0),
  );
  playButton.addEventListener("click", play);
  stopButton.addEventListener("click", stop);
  exportButton.addEventListener("click", exportWav);
  resetButton.addEventListener("click", () => setSelection(0, duration()));
  testButton.addEventListener("click", testOutput);
  gainInput.addEventListener("input", () => {
    gainValue.value = `${gainInput.value}%`;
    gainValue.textContent = `${gainInput.value}%`;
    media.volume = Number(gainInput.value) / 100;
  });
  fileInput.addEventListener("change", (e) => loadFile(e.target.files[0]));
  ["dragenter", "dragover"].forEach((n) =>
    drop.addEventListener(n, (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    }),
  );
  ["dragleave", "drop"].forEach((n) =>
    drop.addEventListener(n, (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
    }),
  );
  drop.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));
  window.addEventListener("resize", fitCanvas);
  fitCanvas();
})();
