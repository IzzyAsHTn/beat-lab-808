const pads = [...document.querySelectorAll(".pad")];
    const statusLine = document.getElementById("status");
    const roundLabel = document.getElementById("roundLabel");
    const startButton = document.getElementById("start");
    const howto = document.getElementById("howto");
    const gameModeTitle = document.getElementById("gameModeTitle");
    const soundModeButtons = [document.getElementById("drumMode"), document.getElementById("noteMode")];
    const gameModeButtons = [document.getElementById("simonGame"), document.getElementById("patternGame")];
    const modeButtons = [...soundModeButtons, ...gameModeButtons];
    const padSets = {
      drums: [
        { name:"Grosse caisse", glyph:"●", aria:"Grosse caisse" },
        { name:"Caisse claire", glyph:"✳", aria:"Caisse claire" },
        { name:"Charleston", glyph:"◌", aria:"Charleston" },
        { name:"Clap", glyph:"✦", aria:"Clap" }
      ],
      notes: [
        { name:"Sol grave", glyph:"♪", aria:"Note Sol grave" },
        { name:"Do", glyph:"♪", aria:"Note Do" },
        { name:"Mi", glyph:"♪", aria:"Note Mi" },
        { name:"Sol aigu", glyph:"♪", aria:"Note Sol aigu" }
      ]
    };
    const noteFrequencies = [196.00, 261.63, 329.63, 392.00];
    const bestByMode = { drums:0, notes:0 };
    const bestPatternsByMode = { drums:0, notes:0 };
    let mode = "drums";
    let gameMode = "simon";
    let audioContext;
    let sequence = [];
    let inputIndex = 0;
    let completedPatterns = 0;
    let phase = "idle";
    let tempo = 630;
    let handlingInput = false;

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    function updateStatus(message) { statusLine.innerHTML = message; }
    function setPadsDisabled(disabled) { pads.forEach(pad => pad.disabled = disabled); }
    function setModeControlsDisabled(disabled) { modeButtons.forEach(button => button.disabled = disabled); }
    function updateRoundLabel() {
      if (gameMode === "pattern") {
        roundLabel.innerHTML = "Meilleurs motifs : <strong>" + bestPatternsByMode[mode] + "</strong>";
        return;
      }
      roundLabel.innerHTML = "Meilleure suite : <strong>" + bestByMode[mode] + "</strong> " + (mode === "notes" ? "notes" : "sons");
    }
    async function ensureAudioReady() {
      audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state !== "running") await audioContext.resume();
      if (audioContext.state !== "running") throw new Error("AudioContext did not enter running state");
    }
    function renderMode() {
      padSets[mode].forEach((info, id) => {
        const pad = pads[id];
        pad.querySelector(".glyph").textContent = info.glyph;
        pad.querySelector(".name").textContent = info.name;
        pad.setAttribute("aria-label", info.aria);
      });
      soundModeButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
      gameModeButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === gameMode)));
      updateRoundLabel();
      gameModeTitle.textContent = gameMode === "pattern" ? "Motif mystère" : "Simon musical";
      if (gameMode === "pattern") {
        howto.textContent = "Un nouveau motif de 4 " + (mode === "notes" ? "notes" : "sons") + " à chaque tour. Le tempo accélère progressivement.";
      } else {
        howto.textContent = mode === "notes"
          ? "Chaque tour ajoute une note. Une erreur termine la partie."
          : "Chaque tour ajoute un coup. Une erreur termine la partie.";
      }
      document.querySelector(".pads").setAttribute("aria-label", mode === "notes" ? "Pads de notes" : "Pads de percussion");
    }
    function chooseMode(nextMode) {
      if (phase === "playback" || phase === "input" || phase === "between") return;
      mode = nextMode;
      phase = "idle";
      sequence = [];
      inputIndex = 0;
      completedPatterns = 0;
      handlingInput = false;
      setPadsDisabled(false);
      setModeControlsDisabled(false);
      startButton.disabled = false;
      startButton.textContent = "Lancer la partie";
      renderMode();
      const soundName = mode === "notes" ? "notes" : "sons";
      updateStatus(gameMode === "pattern"
        ? "Mode " + soundName + " choisi. Chaque tour propose un nouveau motif à reproduire."
        : mode === "notes"
          ? "Mode notes choisi. Écoute la suite, puis retrouve les notes dans l'ordre."
          : "Mode percussions choisi. Écoute la suite, puis retrouve les sons dans l'ordre.");
    }
    function chooseGameMode(nextGameMode) {
      if (phase === "playback" || phase === "input" || phase === "between") return;
      gameMode = nextGameMode;
      phase = "idle";
      sequence = [];
      inputIndex = 0;
      completedPatterns = 0;
      handlingInput = false;
      setPadsDisabled(false);
      setModeControlsDisabled(false);
      startButton.disabled = false;
      startButton.textContent = "Lancer la partie";
      renderMode();
      updateStatus(gameMode === "pattern"
        ? "Motif mystère choisi. Écoute une phrase musicale, puis reproduis-la. Chaque tour propose un nouveau motif."
        : "Séquence Simon choisie. Écoute la suite, puis reproduis-la. Elle s'allongera à chaque tour.");
    }
    modeButtons[0].dataset.mode = "drums";
    modeButtons[1].dataset.mode = "notes";
    soundModeButtons[0].dataset.mode = "drums";
    soundModeButtons[1].dataset.mode = "notes";
    gameModeButtons[0].dataset.mode = "simon";
    gameModeButtons[1].dataset.mode = "pattern";
    soundModeButtons.forEach(button => button.addEventListener("click", () => chooseMode(button.dataset.mode)));
    gameModeButtons.forEach(button => button.addEventListener("click", () => chooseGameMode(button.dataset.mode)));

    function makeSound(id) {
      audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioContext;
      if (ctx.state === "running") {
        scheduleSound(id, ctx);
      } else {
        void ctx.resume().then(() => {
          if (ctx.state === "running") scheduleSound(id, ctx);
        }).catch(() => {
          updateStatus("Le son est suspendu par le navigateur. Clique sur « Lancer la partie » pour le réactiver.");
        });
      }
    }

    function scheduleSound(id, ctx) {
      const now = ctx.currentTime;
      if (mode === "notes") {
        const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = noteFrequencies[id];
        filter.type = "lowpass";
        filter.frequency.value = 2600;
        filter.Q.value = .7;
        gain.gain.setValueAtTime(.001, now);
        gain.gain.exponentialRampToValueAtTime(.13, now + .008);
        gain.gain.exponentialRampToValueAtTime(.001, now + .34);
        osc.connect(filter).connect(gain).connect(ctx.destination);
        osc.start(now); osc.stop(now + .35);
        return;
      }
      if (id === 0) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + .13);
        gain.gain.setValueAtTime(.8, now);
        gain.gain.exponentialRampToValueAtTime(.001, now + .24);
        osc.connect(gain).connect(ctx.destination); osc.start(now); osc.stop(now + .25);
      } else if (id === 2) {
        const duration = .09, buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i=0;i<data.length;i++) data[i] = Math.random() * 2 - 1;
        const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        source.buffer = buffer; filter.type = "highpass"; filter.frequency.value = 6500;
        gain.gain.setValueAtTime(.24, now); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
        source.connect(filter).connect(gain).connect(ctx.destination); source.start(now);
      } else {
        const duration = id === 1 ? .16 : .11, buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i=0;i<data.length;i++) data[i] = Math.random() * 2 - 1;
        const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        source.buffer = buffer; filter.type = "bandpass"; filter.frequency.value = id === 1 ? 1800 : 1200; filter.Q.value = id === 1 ? .7 : .45;
        gain.gain.setValueAtTime(id === 1 ? .45 : .33, now); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
        source.connect(filter).connect(gain).connect(ctx.destination); source.start(now);
        if (id === 1) {
          const osc = ctx.createOscillator(), tone = ctx.createGain();
          osc.type = "triangle"; osc.frequency.value = 180;
          tone.gain.setValueAtTime(.2, now); tone.gain.exponentialRampToValueAtTime(.001, now + .09);
          osc.connect(tone).connect(ctx.destination); osc.start(now); osc.stop(now + .1);
        }
      }
    }

    async function flash(id, duration=190) {
      const pad = pads[id];
      pad.classList.add("is-lit");
      makeSound(id);
      await wait(duration);
      pad.classList.remove("is-lit");
    }

    async function playSequence() {
      if (phase !== "playback") return;
      setPadsDisabled(true);
      setModeControlsDisabled(true);
      startButton.disabled = true;
      startButton.textContent = "Écoute…";
      const unit = mode === "notes" ? "note" : "son";
      updateStatus(gameMode === "pattern"
        ? "Écoute bien le motif : <strong>" + sequence.length + " " + (sequence.length > 1 ? unit + "s" : unit) + "</strong>"
        : "Écoute bien : <strong>" + sequence.length + " " + (sequence.length > 1 ? unit + "s" : unit) + "</strong>");
      await wait(450);
      for (const id of sequence) {
        if (phase !== "playback") return;
        await flash(id, 190);
        await wait(tempo - 190);
      }
      phase = "input";
      inputIndex = 0;
      setPadsDisabled(false);
      startButton.textContent = "À toi de jouer";
      updateStatus(gameMode === "pattern"
        ? "À toi : reproduis ce motif dans le même ordre."
        : mode === "notes"
          ? "À toi : rejoue <strong>" + sequence.length + " " + (sequence.length > 1 ? "notes" : "note") + "</strong> dans le même ordre."
          : "À toi : rejoue <strong>" + sequence.length + " " + (sequence.length > 1 ? "sons" : "son") + "</strong> dans le même ordre.");
    }

    function beginRound() {
      phase = "playback";
      if (gameMode === "simon") {
        sequence.push(Math.floor(Math.random() * pads.length));
      } else {
        sequence = Array.from({ length:4 }, () => Math.floor(Math.random() * pads.length));
      }
      void playSequence();
    }

    async function fail() {
      phase = "over";
      setPadsDisabled(true);
      startButton.disabled = false;
      startButton.textContent = "Rejouer";
      makeSound(1); await wait(85); makeSound(1);
      if (gameMode === "pattern") {
        updateStatus("Fin de partie. Tu as reproduit <strong>" + completedPatterns + " " + (completedPatterns > 1 ? "motifs" : "motif") + "</strong> à la suite.");
      } else {
        const completed = Math.max(0, sequence.length - 1);
        const unit = mode === "notes" ? "notes" : "sons";
        updateStatus("Fin de partie. Tu as réussi <strong>" + completed + " " + (completed > 1 ? "tours" : "tour") + "</strong> et retrouvé " + sequence.length + " " + unit + " d'affilée.");
      }
      setModeControlsDisabled(false);
    }

    pads.forEach((pad, id) => pad.addEventListener("click", async () => {
      if (phase !== "input" || handlingInput) return;
      handlingInput = true;
      const expected = sequence[inputIndex];
      await flash(id, 120);
      if (id !== expected) { handlingInput = false; await fail(); return; }
      inputIndex++;
      handlingInput = false;
      if (inputIndex < sequence.length) return;
      phase = "between";
      if (gameMode === "pattern") {
        completedPatterns++;
        bestPatternsByMode[mode] = Math.max(bestPatternsByMode[mode], completedPatterns);
        updateStatus("Motif retrouvé ! Un nouveau pattern arrive…");
        tempo = Math.max(360, 630 - Math.floor(completedPatterns / 3) * 40);
      } else {
        bestByMode[mode] = Math.max(bestByMode[mode], sequence.length);
        updateStatus("Bien joué ! Le groove s'allonge…");
        tempo = Math.max(300, 630 - Math.floor(sequence.length / 4) * 45);
      }
      updateRoundLabel();
      await wait(700);
      if (phase === "between") beginRound();
    }));

    startButton.addEventListener("click", async () => {
      if (phase === "playback" || phase === "input" || phase === "between") return;
      try {
        await ensureAudioReady();
      } catch (error) {
        phase = "idle";
        setPadsDisabled(false);
        setModeControlsDisabled(false);
        startButton.disabled = false;
        startButton.textContent = "Réessayer";
        updateStatus("Le son n’a pas démarré. Vérifie la sortie audio, puis réessaie.");
        return;
      }
      sequence = [];
      inputIndex = 0;
      completedPatterns = 0;
      handlingInput = false;
      tempo = 630;
      setModeControlsDisabled(true);
      startButton.textContent = "Écoute…";
      beginRound();
    });
    renderMode();
