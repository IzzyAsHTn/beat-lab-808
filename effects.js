(() => {
  const $ = (selector) => document.querySelector(selector);
  const file = $("#file"),
    previewButton = $("#preview"),
    renderButton = $("#render"),
    playButton = $("#play"),
    downloadButton = $("#download"),
    status = $("#status"),
    name = $("#name");
  const controls = ["cut", "drive", "delay", "reverb"].map((id) => $("#" + id));
  let inputBuffer = null,
    renderedBuffer = null,
    player = new Audio(),
    renderUrl = "",
    loadToken = 0,
    renderToken = 0,
    preview = null,
    previewToken = 0;
  const defaultRenderText = "Créer le rendu et préparer l’écoute";
  const setStatus = (message) => {
    status.textContent = message;
  };
  function clearRender(message = "") {
    ++renderToken;
    player.pause();
    player.removeAttribute("src");
    player.load();
    if (renderUrl) {
      URL.revokeObjectURL(renderUrl);
      renderUrl = "";
    }
    renderedBuffer = null;
    playButton.disabled = true;
    downloadButton.disabled = true;
    if (message) setStatus(message);
  }
  function smoothParam(param, value, context) {
    const now = context.currentTime;
    if (typeof param.setTargetAtTime === "function")
      param.setTargetAtTime(value, now, 0.025);
    else param.setValueAtTime(value, now);
  }
  function updatePreview() {
    if (!preview) return;
    const settings = {
      cut: Number($("#cut").value),
      drive: Number($("#drive").value) / 100,
      delay: Number($("#delay").value) / 100,
      reverb: Number($("#reverb").value) / 100,
    };
    const { context, filter, distortion, dry, delayWet, reverbWet } = preview;
    smoothParam(filter.frequency, settings.cut, context);
    distortion.curve = makeDriveCurve(settings.drive);
    smoothParam(
      dry.gain,
      1 - Math.max(settings.delay, settings.reverb) * 0.35,
      context,
    );
    if (delayWet) smoothParam(delayWet.gain, settings.delay * 0.65, context);
    if (reverbWet) smoothParam(reverbWet.gain, settings.reverb * 0.65, context);
  }
  function stopPreview(message = "") {
    ++previewToken;
    const active = preview;
    preview = null;
    previewButton.textContent = "▶ Préécouter en boucle";
    previewButton.setAttribute("aria-pressed", "false");
    previewButton.disabled = !inputBuffer || renderButton.disabled;
    if (active) {
      try {
        active.source.stop();
      } catch (error) {}
      for (const node of active.nodes)
        try {
          node.disconnect();
        } catch (error) {}
      if (active.context.state !== "closed")
        active.context
          .close()
          .catch((error) =>
            console.warn("Fermeture de la préécoute audio", error),
          );
    }
    if (message) setStatus(message);
  }
  function setPreviewBusy(busy) {
    previewButton.disabled = busy || !inputBuffer || renderButton.disabled;
    previewButton.textContent = busy
      ? "Préparation de la préécoute…"
      : preview
        ? "■ Arrêter la préécoute"
        : "▶ Préécouter en boucle";
    previewButton.setAttribute("aria-pressed", String(Boolean(preview)));
  }
  function setBusy(busy) {
    file.disabled = busy;
    controls.forEach((control) => (control.disabled = busy));
    renderButton.disabled = busy || !inputBuffer;
    renderButton.textContent = busy ? "Rendu en cours…" : defaultRenderText;
    setPreviewBusy(busy);
  }
  function formatError(action, error) {
    console.error("[Beat Lab Effets] " + action, error);
    const detail =
      error && error.message
        ? error.message
        : error && error.name
          ? error.name
          : "erreur inconnue";
    return action + " : " + detail;
  }
  const formatters = {
    cut: (value) =>
      Number(value) >= 1000
        ? (Number(value) / 1000).toFixed(Number(value) >= 10000 ? 0 : 1) +
          " kHz"
        : value + " Hz",
    drive: (value) => value + "%",
    delay: (value) => value + "%",
    reverb: (value) => value + "%",
  };
  controls.forEach((control) =>
    control.addEventListener("input", () => {
      $("#" + control.id + "v").textContent = formatters[control.id](
        control.value,
      );
      if (renderUrl || renderedBuffer) {
        clearRender(
          "Paramètres modifiés · crée un nouveau rendu pour écouter ou télécharger les effets.",
        );
      }
      if (preview) {
        updatePreview();
        setStatus("Préécoute en boucle · effets ajustés en direct.");
      }
    }),
  );
  file.addEventListener("change", async () => {
    const selected = file.files && file.files[0];
    if (selected) {
      try {
        window.BeatLabCore.checkAudioFile(selected);
      } catch (error) {
        setStatus(error.message);
        return;
      }
    }
    const token = ++loadToken;
    stopPreview();
    clearRender();
    inputBuffer = null;
    renderButton.disabled = true;
    previewButton.disabled = true;
    name.textContent = selected ? selected.name : "Aucun fichier chargé";
    if (!selected) {
      setStatus(
        "Sélectionne un fichier WAV, AIFF, MP3 ou compatible avec ton navigateur.",
      );
      return;
    }
    setStatus("Chargement et décodage de « " + selected.name + " »…");
    let decodeContext;
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass)
        throw new Error(
          "AudioContext n’est pas disponible dans ce navigateur.",
        );
      decodeContext = new AudioContextClass();
      const bytes = await selected.arrayBuffer();
      const decoded = await decodeContext.decodeAudioData(bytes);
      if (token !== loadToken) return;
      if (decoded.duration > 120) {
        setStatus(
          "Fichier décodé (" +
            decoded.duration.toFixed(1) +
            " s), mais trop long : le rendu est limité à 2 minutes. Découpe un extrait dans le Découpeur audio.",
        );
        return;
      }
      inputBuffer = decoded;
      renderButton.disabled = false;
      setPreviewBusy(false);
      setStatus(
        "Fichier prêt · " +
          decoded.numberOfChannels +
          " piste(s) · " +
          decoded.sampleRate +
          " Hz · " +
          decoded.duration.toFixed(2) +
          " s",
      );
    } catch (error) {
      if (token !== loadToken) return;
      inputBuffer = null;
      renderButton.disabled = true;
      setStatus(
        formatError("Impossible de décoder ce fichier", error) +
          " Essaie un WAV PCM ou un MP3 standard.",
      );
    } finally {
      if (decodeContext)
        try {
          await decodeContext.close();
        } catch (error) {
          console.warn("Fermeture du décodeur audio", error);
        }
    }
  });
  function makeDriveCurve(amount) {
    const size = 44100,
      curve = new Float32Array(size),
      k = amount * 180;
    for (let i = 0; i < size; i++) {
      const x = (i * 2) / (size - 1) - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }
  function makeImpulse(context, seconds = 1.8) {
    const length = Math.floor(context.sampleRate * seconds),
      channels = Math.min(2, context.destination.maxChannelCount || 2);
    const impulse = context.createBuffer(channels, length, context.sampleRate);
    let seed = 0x6d2b79f5;
    for (let channel = 0; channel < channels; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const noise = ((seed >>> 0) / 4294967295) * 2 - 1;
        const decay = Math.pow(1 - i / length, 3.2);
        samples[i] = noise * decay * (channel === 0 ? 1 : 0.92);
      }
    }
    return impulse;
  }
  previewButton.addEventListener("click", async () => {
    if (preview) {
      stopPreview("Préécoute arrêtée.");
      return;
    }
    if (!inputBuffer || previewButton.disabled) return;
    const sourceBuffer = inputBuffer,
      token = ++previewToken;
    previewButton.disabled = true;
    previewButton.textContent = "Préparation de la préécoute…";
    let pendingContext = null;
    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass)
        throw new Error(
          "AudioContext n’est pas disponible dans ce navigateur.",
        );
      const context = (pendingContext = new AudioContextClass());
      const source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        distortion = context.createWaveShaper(),
        output = context.createGain();
      const dry = context.createGain(),
        nodes = [source, filter, distortion, dry, output];
      source.buffer = sourceBuffer;
      source.loop = true;
      filter.type = "lowpass";
      filter.Q.value = 0.707;
      distortion.oversample = "4x";
      source.connect(filter).connect(distortion);
      distortion.connect(dry).connect(output);
      const settings = {
        delay: Number($("#delay").value) / 100,
        reverb: Number($("#reverb").value) / 100,
      };
      let delayWet = null,
        reverbWet = null;
      {
        const delay = context.createDelay(1.2),
          feedback = context.createGain(),
          damping = context.createBiquadFilter();
        delayWet = context.createGain();
        delay.delayTime.value = 0.28;
        feedback.gain.value = 0.32;
        damping.type = "lowpass";
        damping.frequency.value = 5200;
        delayWet.gain.value = settings.delay * 0.65;
        distortion.connect(delay);
        delay.connect(damping).connect(feedback).connect(delay);
        delay.connect(delayWet).connect(output);
        nodes.push(delay, feedback, damping, delayWet);
      }
      {
        const convolver = context.createConvolver();
        reverbWet = context.createGain();
        convolver.buffer = makeImpulse(context);
        reverbWet.gain.value = settings.reverb * 0.65;
        distortion.connect(convolver).connect(reverbWet).connect(output);
        nodes.push(convolver, reverbWet);
      }
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      output.connect(limiter).connect(context.destination);
      nodes.push(limiter);
      preview = {
        context,
        source,
        filter,
        distortion,
        dry,
        delayWet,
        reverbWet,
        nodes,
      };
      updatePreview();
      setPreviewBusy(true);
      await context.resume();
      if (token !== previewToken || preview?.source !== source) {
        try {
          source.stop();
        } catch (error) {}
        return;
      }
      source.start(0);
      setPreviewBusy(false);
      setStatus("Préécoute en boucle · ajuste les effets en direct.");
      source.onended = () => {
        if (preview?.source === source) stopPreview("Préécoute terminée.");
      };
    } catch (error) {
      if (
        pendingContext &&
        preview?.context !== pendingContext &&
        pendingContext.state !== "closed"
      )
        pendingContext
          .close()
          .catch((closeError) =>
            console.warn("Fermeture de la préécoute audio", closeError),
          );
      if (token === previewToken) {
        stopPreview();
        setStatus(
          formatError("Préécoute impossible", error) +
            " Vérifie la sortie audio du navigateur.",
        );
      }
    }
  });
  function applyOutputCeiling(buffer, ceilingDb = -1) {
    const ceiling = Math.pow(10, ceilingDb / 20);
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++)
        peak = Math.max(peak, Math.abs(samples[i]));
    }
    const gain = peak > ceiling ? ceiling / peak : 1;
    if (gain < 1)
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) samples[i] *= gain;
      }
    return { peak, gain };
  }
  function encodeWav(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels),
      frames = buffer.length,
      bytesPerSample = 2,
      dataBytes = frames * channels * bytesPerSample;
    const bytes = new ArrayBuffer(44 + dataBytes),
      view = new DataView(bytes);
    let offset = 0;
    const writeText = (text) => {
      for (let i = 0; i < text.length; i++)
        view.setUint8(offset++, text.charCodeAt(i));
    };
    writeText("RIFF");
    view.setUint32(offset, 36 + dataBytes, true);
    offset += 4;
    writeText("WAVE");
    writeText("fmt ");
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, channels, true);
    offset += 2;
    view.setUint32(offset, buffer.sampleRate, true);
    offset += 4;
    view.setUint32(offset, buffer.sampleRate * channels * bytesPerSample, true);
    offset += 4;
    view.setUint16(offset, channels * bytesPerSample, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
    writeText("data");
    view.setUint32(offset, dataBytes, true);
    offset += 4;
    for (let frame = 0; frame < frames; frame++)
      for (let channel = 0; channel < channels; channel++) {
        const sample = Math.max(
          -1,
          Math.min(1, buffer.getChannelData(channel)[frame] || 0),
        );
        view.setInt16(
          offset,
          sample < 0 ? sample * 32768 : sample * 32767,
          true,
        );
        offset += 2;
      }
    return new Blob([bytes], { type: "audio/wav" });
  }
  renderButton.addEventListener("click", async () => {
    if (!inputBuffer || renderButton.disabled) return;
    stopPreview();
    const sourceBuffer = inputBuffer;
    const settings = {
      cut: Number($("#cut").value),
      drive: Number($("#drive").value) / 100,
      delay: Number($("#delay").value) / 100,
      reverb: Number($("#reverb").value) / 100,
    };
    const token = ++renderToken;
    clearRender();
    renderToken = token;
    setBusy(true);
    setStatus("Application des effets et création du rendu…");
    try {
      const OfflineContext =
        window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineContext)
        throw new Error(
          "Le rendu audio hors ligne n’est pas pris en charge par ce navigateur.",
        );
      const tail = settings.delay > 0 || settings.reverb > 0 ? 2.4 : 0;
      const channels = Math.max(1, Math.min(2, sourceBuffer.numberOfChannels));
      const frames =
        sourceBuffer.length + Math.ceil(tail * sourceBuffer.sampleRate);
      const context = new OfflineContext(
        channels,
        frames,
        sourceBuffer.sampleRate,
      );
      const source = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        distortion = context.createWaveShaper(),
        output = context.createGain();
      source.buffer = sourceBuffer;
      filter.type = "lowpass";
      filter.frequency.value = settings.cut;
      filter.Q.value = 0.707;
      distortion.curve = makeDriveCurve(settings.drive);
      distortion.oversample = "4x";
      source.connect(filter).connect(distortion);
      const wet = Math.max(settings.delay, settings.reverb);
      const dry = context.createGain();
      dry.gain.value = 1 - wet * 0.35;
      distortion.connect(dry).connect(output);
      if (settings.delay > 0) {
        const delay = context.createDelay(1.2),
          feedback = context.createGain(),
          damping = context.createBiquadFilter(),
          delayWet = context.createGain();
        delay.delayTime.value = 0.28;
        feedback.gain.value = 0.32;
        damping.type = "lowpass";
        damping.frequency.value = 5200;
        delayWet.gain.value = settings.delay * 0.65;
        distortion.connect(delay);
        delay.connect(damping).connect(feedback).connect(delay);
        delay.connect(delayWet).connect(output);
      }
      if (settings.reverb > 0) {
        const convolver = context.createConvolver(),
          reverbWet = context.createGain();
        convolver.buffer = makeImpulse(context);
        reverbWet.gain.value = settings.reverb * 0.65;
        distortion.connect(convolver).connect(reverbWet).connect(output);
      }
      output.connect(context.destination);
      source.start(0);
      const result = await context.startRendering();
      if (token !== renderToken) return;
      const peak = applyOutputCeiling(result);
      renderedBuffer = result;
      renderUrl = URL.createObjectURL(encodeWav(result));
      player.src = renderUrl;
      player.onended = () => {
        if (token === renderToken)
          setStatus("Lecture terminée · le rendu reste disponible.");
      };
      playButton.disabled = false;
      downloadButton.disabled = false;
      const ceiling =
        peak.gain < 1
          ? " · crête sécurisée à −1 dBFS"
          : " · crête sous −1 dBFS";
      setStatus(
        "Rendu traité prêt · " +
          result.duration.toFixed(2) +
          " s · WAV PCM 16 bits" +
          ceiling,
      );
    } catch (error) {
      if (token === renderToken)
        setStatus(formatError("Échec du rendu audio", error));
    } finally {
      if (token === renderToken) setBusy(false);
    }
  });
  playButton.addEventListener("click", async () => {
    if (!renderUrl) return;
    try {
      player.currentTime = 0;
      await player.play();
      setStatus("Lecture du rendu traité…");
    } catch (error) {
      setStatus(
        formatError("Lecture impossible", error) +
          " Vérifie la sortie audio du navigateur.",
      );
    }
  });
  downloadButton.addEventListener("click", () => {
    if (!renderedBuffer || !renderUrl) return;
    const link = document.createElement("a");
    link.href = renderUrl;
    link.download = "beat-lab-effets-traites.wav";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setStatus(
      "Téléchargement du WAV traité · " +
        renderedBuffer.duration.toFixed(2) +
        " s.",
    );
  });
})();
