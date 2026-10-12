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
    gameResult,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BeatLabCore = api;
})(typeof window === "undefined" ? globalThis : window);
