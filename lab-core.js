/* Small state helpers shared by the audio workshops and their regression tests. */
(function (root) {
  "use strict";

  function latestOperation() {
    let version = 0;
    return {
      begin: () => ++version,
      current: (token) => token === version,
      version: () => version,
    };
  }

  function serialQueue() {
    let previous = Promise.resolve();
    return (operation) => {
      const result = previous.then(operation);
      previous = result.catch(() => {});
      return result;
    };
  }

  function stepDuration(bpm, step, swing) {
    const base = 60 / Number(bpm) / 4;
    return base * (swing ? (step % 2 === 0 ? 1.12 : 0.88) : 1);
  }

  function checkAudioFile(file) {
    if (file.size > 50_000_000) {
      throw new Error(
        "Ce fichier dépasse 50 Mo. Choisis un fichier plus léger.",
      );
    }
  }

  async function checkAudioFileDuration(file, maxSeconds = 120) {
    const AudioElement = root.Audio;
    if (!AudioElement || !root.URL || !root.URL.createObjectURL)
      throw new Error("Impossible de vérifier la durée de ce fichier audio.");
    const url = root.URL.createObjectURL(file);
    let probe;
    try {
      probe = new AudioElement();
      probe.preload = "metadata";
      const duration = await new Promise((resolve, reject) => {
        const timeout = root.setTimeout(
          () => reject(new Error("La lecture des métadonnées a expiré.")),
          15000,
        );
        const finish = (callback, value) => {
          root.clearTimeout(timeout);
          probe.onloadedmetadata = null;
          probe.onerror = null;
          callback(value);
        };
        probe.onloadedmetadata = () => {
          const seconds = Number(probe.duration);
          if (!Number.isFinite(seconds) || seconds < 0)
            finish(
              reject,
              new Error("La durée de ce fichier audio est illisible."),
            );
          else finish(resolve, seconds);
        };
        probe.onerror = () =>
          finish(
            reject,
            new Error("Impossible de lire la durée de ce fichier audio."),
          );
        try {
          probe.src = url;
          probe.load();
        } catch (error) {
          finish(reject, error);
        }
      });
      if (duration > maxSeconds)
        throw new Error(
          `Ce fichier dure ${duration.toFixed(1)} s. La limite est de ${Math.round(maxSeconds / 60)} minutes.`,
        );
      return duration;
    } finally {
      if (probe) {
        probe.pause();
        probe.removeAttribute("src");
        probe.load();
      }
      root.URL.revokeObjectURL(url);
    }
  }

  function gameResult(completed, mode) {
    const unit = mode === "notes" ? "note" : "son";
    return (
      "Fin de partie. Tu as réussi <strong>" +
      completed +
      " " +
      (completed > 1 ? "tours" : "tour") +
      "</strong>. Ta plus longue suite réussie : " +
      completed +
      " " +
      unit +
      (completed > 1 ? "s" : "") +
      "."
    );
  }

  const api = Object.freeze({
    latestOperation,
    serialQueue,
    stepDuration,
    checkAudioFile,
    checkAudioFileDuration,
    gameResult,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BeatLabCore = api;
})(typeof window === "undefined" ? globalThis : window);
