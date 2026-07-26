(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const el = {
    stage: document.querySelector(".stage"),
    appTitle: $("appTitle"),
    phase: $("phaseLabel"),
    time: $("timeLabel"),
    sub: $("subLabel"),
    ringFg: $("ringFg"),
    setNow: $("setNow"),
    setTotal: $("setTotal"),
    repNow: $("repNow"),
    repTotal: $("repTotal"),
    startBtn: $("startBtn"),
    pauseBtn: $("pauseBtn"),
    resetBtn: $("resetBtn"),
    settingsBtn: $("settingsBtn"),
    dialog: $("settingsDialog"),

    exercisePreset: $("exercisePreset"),
    exerciseCustomRow: $("exerciseCustomRow"),
    exerciseName: $("exerciseName"),

    sets: $("sets"), setsRange: $("setsRange"),
    reps: $("reps"), repsRange: $("repsRange"),
    bridgeSec: $("bridgeSec"), bridgeSecRange: $("bridgeSecRange"),
    restSec: $("restSec"), restSecRange: $("restSecRange"),
    breakSec: $("breakSec"), breakSecRange: $("breakSecRange"),
    prepareSec: $("prepareSec"), prepareSecRange: $("prepareSecRange"),

    voiceSelect: $("voiceSelect"),
    voiceRate: $("voiceRate"), voiceRateRange: $("voiceRateRange"),
    voicePitch: $("voicePitch"), voicePitchRange: $("voicePitchRange"),
    encourage: $("encourage"),
    beeps: $("beeps"),
    voiceTest: $("voiceTest"),

    msgMid: $("msgMid"),
    msgHalf: $("msgHalf"),
    msgSetEnd: $("msgSetEnd"),
    msgStart: $("msgStart"),
    msgRepStart: $("msgRepStart"),
    msgRepEnd: $("msgRepEnd"),
    msgDone: $("msgDone"),

    resetDefaults: $("resetDefaults"),
  };

  const PRESET_EXERCISES = ["브릿지", "플랭크", "스쿼트", "런지", "윗몸일으키기", "푸시업", "사이드플랭크"];

  const DEFAULTS = {
    exercise: "브릿지",
    sets: 3,
    reps: 10,
    bridgeSec: 30,
    restSec: 7,
    breakSec: 12,
    prepareSec: 5,
    voiceURI: "",
    voiceRate: 1.0,
    voicePitch: 1.0,
    encourage: true,
    beeps: true,
    messages: {
      mid: [
        "잘하고 있어요, 조금만 더 버텨요.",
        "엉덩이 꽉 조여요.",
        "호흡 유지하세요.",
        "코어에 힘 주세요.",
        "허리 무리 없이, 엉덩이로 밀어요.",
      ],
      half: [
        "절반 지났어요. 계속 갑시다.",
        "반 왔어요. 좋아요.",
      ],
      setEnd: [
        "한 세트 완료. 훌륭해요.",
        "잘했어요. 잠시 쉬어요.",
        "좋습니다. 다음 세트도 힘내요.",
      ],
      start: "{sets}세트 {reps}회 {exercise}를 시작합니다. 준비하세요.",
      repStart: "{set}세트 {rep}회, 시작.",
      repEnd: "{rep}회 완료. 잠시 쉬세요.",
      setBreak: "{set}세트 완료. {sec}초 후 다음 세트 시작.",
      done: "모든 세트를 마쳤습니다. 정말 수고하셨어요.",
    },
  };

  const STORAGE_KEY = "workout-timer.settings.v2";
  let settings = loadSettings();

  const CIRC = 2 * Math.PI * 90;
  el.ringFg.style.strokeDasharray = String(CIRC);

  // ---- Speech ----
  const synth = window.speechSynthesis;
  let voices = [];
  let selectedVoice = null;

  function loadVoices() {
    voices = (synth?.getVoices() || []).slice();
    voices.sort((a, b) => {
      const aKo = /^ko/i.test(a.lang) ? 0 : 1;
      const bKo = /^ko/i.test(b.lang) ? 0 : 1;
      if (aKo !== bKo) return aKo - bKo;
      return a.name.localeCompare(b.name);
    });
    el.voiceSelect.innerHTML = "";
    if (voices.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "기본 음성";
      opt.value = "";
      el.voiceSelect.appendChild(opt);
    } else {
      for (const v of voices) {
        const opt = document.createElement("option");
        opt.textContent = `${v.name} (${v.lang})${v.default ? " ★" : ""}`;
        opt.value = v.voiceURI;
        el.voiceSelect.appendChild(opt);
      }
    }
    const savedURI = settings.voiceURI;
    selectedVoice =
      voices.find((v) => v.voiceURI === savedURI) ||
      voices.find((v) => /^ko/i.test(v.lang)) ||
      voices[0] ||
      null;
    if (selectedVoice) el.voiceSelect.value = selectedVoice.voiceURI;
  }

  if (synth) {
    loadVoices();
    if (typeof synth.onvoiceschanged !== "undefined") {
      synth.onvoiceschanged = loadVoices;
    }
  }

  function speak(text, opts = {}) {
    if (!synth || !text) return;
    try {
      if (opts.priority) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (selectedVoice) u.voice = selectedVoice;
      u.lang = selectedVoice?.lang || "ko-KR";
      u.rate = clamp(Number(settings.voiceRate) || 1, 0.5, 2);
      u.pitch = clamp(Number(settings.voicePitch) || 1, 0.5, 2);
      u.volume = 1;
      synth.speak(u);
    } catch (_) {}
  }

  // ---- Audio (beep) ----
  let audioCtx = null;
  function beep(freq = 880, dur = 0.12, gain = 0.15) {
    if (!settings.beeps) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g);
      g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (_) {}
  }

  // ---- Wake Lock ----
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (_) {}
  }
  async function releaseWakeLock() {
    try { await wakeLock?.release(); } catch (_) {}
    wakeLock = null;
  }
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && state.running && !wakeLock) {
      await requestWakeLock();
    }
  });

  // ---- Timer state machine ----
  const PHASES = {
    IDLE: "idle",
    PREPARE: "prepare",
    BRIDGE: "bridge",
    REST: "rest",
    BREAK: "break",
    DONE: "done",
  };

  const state = {
    phase: PHASES.IDLE,
    setIdx: 0,
    repIdx: 0,
    remainMs: 0,
    totalMs: 0,
    running: false,
    lastTick: 0,
    spokenTicks: new Set(),
    encouragementUsed: new Set(),
  };

  function pick(arr) {
    const list = (arr || []).filter((s) => s && s.trim());
    if (list.length === 0) return "";
    return list[Math.floor(Math.random() * list.length)];
  }

  function fmt(template, ctx) {
    if (!template) return "";
    return String(template).replace(/\{(\w+)\}/g, (_, k) => (k in ctx ? String(ctx[k]) : `{${k}}`));
  }

  function ctxNow() {
    return {
      exercise: settings.exercise || "운동",
      set: state.setIdx + 1,
      sets: settings.sets,
      rep: state.repIdx + 1,
      reps: settings.reps,
      sec: 0,
    };
  }

  function setPhaseClass(phase) {
    el.stage.classList.remove("phase-prepare", "phase-bridge", "phase-rest", "phase-break", "phase-done");
    if (phase !== PHASES.IDLE) el.stage.classList.add(`phase-${phase}`);
  }

  function updateRing() {
    const ratio = state.totalMs > 0 ? clamp(state.remainMs / state.totalMs, 0, 1) : 0;
    el.ringFg.style.strokeDashoffset = String(CIRC * (1 - ratio));
  }

  function updateCounters() {
    el.setTotal.textContent = String(settings.sets);
    el.repTotal.textContent = String(settings.reps);
    el.setNow.textContent = String(Math.min(state.setIdx + 1, settings.sets));
    el.repNow.textContent = String(Math.min(state.repIdx + 1, settings.reps));
  }

  function updateTitle() {
    el.appTitle.textContent = `${settings.exercise || "운동"} 타이머`;
    document.title = `${settings.exercise || "운동"} 타이머`;
  }

  function render() {
    const secs = Math.ceil(state.remainMs / 1000);
    el.time.textContent = String(Math.max(secs, 0)).padStart(2, "0");
    el.time.classList.toggle("low", secs <= 5 && secs > 3 && state.running);
    el.time.classList.toggle("critical", secs <= 3 && secs > 0 && state.running);

    switch (state.phase) {
      case PHASES.IDLE:
        el.phase.textContent = "준비";
        el.sub.textContent = "시작을 눌러 주세요";
        break;
      case PHASES.PREPARE:
        el.phase.textContent = "시작 준비";
        el.sub.textContent = `${settings.exercise} 자세를 취하세요`;
        break;
      case PHASES.BRIDGE:
        el.phase.textContent = settings.exercise;
        el.sub.textContent = `세트 ${state.setIdx + 1} · ${state.repIdx + 1}회`;
        break;
      case PHASES.REST:
        el.phase.textContent = "휴식";
        el.sub.textContent = `다음 ${state.repIdx + 2}회 준비`;
        break;
      case PHASES.BREAK:
        el.phase.textContent = "세트 휴식";
        el.sub.textContent = `다음 세트 ${state.setIdx + 2} 준비`;
        break;
      case PHASES.DONE:
        el.phase.textContent = "완료";
        el.sub.textContent = "수고하셨어요";
        break;
    }
    updateRing();
    updateCounters();
  }

  function enterPhase(phase) {
    state.phase = phase;
    state.spokenTicks = new Set();
    state.encouragementUsed = new Set();
    setPhaseClass(phase);

    switch (phase) {
      case PHASES.PREPARE:
        state.totalMs = Math.max(1, settings.prepareSec) * 1000;
        state.remainMs = state.totalMs;
        speak(fmt(settings.messages.start, { ...ctxNow(), sec: settings.prepareSec }), { priority: true });
        break;
      case PHASES.BRIDGE:
        state.totalMs = settings.bridgeSec * 1000;
        state.remainMs = state.totalMs;
        speak(fmt(settings.messages.repStart, ctxNow()), { priority: true });
        beep(880, 0.15);
        break;
      case PHASES.REST: {
        state.totalMs = settings.restSec * 1000;
        state.remainMs = state.totalMs;
        speak(fmt(settings.messages.repEnd, { ...ctxNow(), sec: settings.restSec }), { priority: true });
        beep(440, 0.15);
        if (state.totalMs <= 0) { advance(); return; }
        break;
      }
      case PHASES.BREAK: {
        state.totalMs = settings.breakSec * 1000;
        state.remainMs = state.totalMs;
        const doneSetCtx = { ...ctxNow(), set: state.setIdx, sec: settings.breakSec };
        let line = fmt(settings.messages.setBreak, doneSetCtx);
        if (settings.encourage) {
          const enc = pick(settings.messages.setEnd);
          if (enc) line = `${enc} ${line}`;
        }
        speak(line, { priority: true });
        beep(330, 0.2);
        if (state.totalMs <= 0) { advance(); return; }
        break;
      }
      case PHASES.DONE:
        state.totalMs = 1;
        state.remainMs = 0;
        speak(fmt(settings.messages.done, ctxNow()), { priority: true });
        beep(660, 0.15); setTimeout(() => beep(880, 0.2), 160);
        stop();
        break;
    }
    render();
  }

  function advance() {
    switch (state.phase) {
      case PHASES.PREPARE:
        state.setIdx = 0;
        state.repIdx = 0;
        enterPhase(PHASES.BRIDGE);
        break;
      case PHASES.BRIDGE:
        if (state.repIdx + 1 >= settings.reps) {
          if (state.setIdx + 1 >= settings.sets) {
            enterPhase(PHASES.DONE);
          } else {
            state.setIdx += 1;
            if (settings.breakSec > 0) enterPhase(PHASES.BREAK);
            else { state.repIdx = 0; enterPhase(PHASES.BRIDGE); }
          }
        } else {
          if (settings.restSec > 0) enterPhase(PHASES.REST);
          else { state.repIdx += 1; enterPhase(PHASES.BRIDGE); }
        }
        break;
      case PHASES.REST:
        state.repIdx += 1;
        enterPhase(PHASES.BRIDGE);
        break;
      case PHASES.BREAK:
        state.repIdx = 0;
        enterPhase(PHASES.BRIDGE);
        break;
    }
  }

  function tick(now) {
    if (!state.running) return;
    const dt = now - state.lastTick;
    state.lastTick = now;
    state.remainMs -= dt;

    handleAnnouncements();

    if (state.remainMs <= 0) {
      advance();
    } else {
      render();
    }

    requestAnimationFrame(tick);
  }

  function handleAnnouncements() {
    const secLeft = Math.ceil(state.remainMs / 1000);

    if ([PHASES.PREPARE, PHASES.BRIDGE, PHASES.REST, PHASES.BREAK].includes(state.phase)) {
      if ([3, 2, 1].includes(secLeft) && !state.spokenTicks.has(secLeft)) {
        state.spokenTicks.add(secLeft);
        speak(String(secLeft));
        beep(secLeft === 1 ? 1200 : 700, 0.08, 0.12);
      }
    }

    if (state.phase === PHASES.BRIDGE && settings.encourage) {
      const half = Math.floor(settings.bridgeSec / 2);
      if (secLeft === half && !state.encouragementUsed.has("half") && settings.bridgeSec >= 20) {
        state.encouragementUsed.add("half");
        const line = pick(settings.messages.half);
        if (line) speak(line);
      }
      const midCue = Math.floor(settings.bridgeSec * 0.7);
      if (secLeft === settings.bridgeSec - midCue &&
          !state.encouragementUsed.has("mid") &&
          (state.repIdx + 1) % 5 === 0) {
        state.encouragementUsed.add("mid");
        const line = pick(settings.messages.mid);
        if (line) speak(line);
      }
    }
  }

  function start() {
    if (state.running) return;
    beep(0, 0.001, 0); // audio unlock
    if (state.phase === PHASES.IDLE || state.phase === PHASES.DONE) {
      state.setIdx = 0;
      state.repIdx = 0;
      if (settings.prepareSec > 0) enterPhase(PHASES.PREPARE);
      else enterPhase(PHASES.BRIDGE);
    }
    state.running = true;
    state.lastTick = performance.now();
    el.startBtn.textContent = "재개";
    el.startBtn.disabled = true;
    el.pauseBtn.disabled = false;
    requestWakeLock();
    requestAnimationFrame(tick);
  }

  function pause() {
    if (!state.running) return;
    state.running = false;
    el.startBtn.textContent = "재개";
    el.startBtn.disabled = false;
    el.pauseBtn.disabled = true;
    speak("일시정지.", { priority: true });
    releaseWakeLock();
  }

  function stop() {
    state.running = false;
    el.startBtn.textContent = "시작";
    el.startBtn.disabled = false;
    el.pauseBtn.disabled = true;
    releaseWakeLock();
  }

  function reset() {
    if (synth) synth.cancel();
    state.running = false;
    state.phase = PHASES.IDLE;
    state.setIdx = 0;
    state.repIdx = 0;
    state.remainMs = 0;
    state.totalMs = 0;
    el.startBtn.textContent = "시작";
    el.startBtn.disabled = false;
    el.pauseBtn.disabled = true;
    setPhaseClass(PHASES.IDLE);
    render();
    releaseWakeLock();
  }

  // ---- Settings ----
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return deepClone(DEFAULTS);
      const parsed = JSON.parse(raw);
      return mergeDeep(deepClone(DEFAULTS), parsed);
    } catch (_) {
      return deepClone(DEFAULTS);
    }
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) {}
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function mergeDeep(target, src) {
    for (const k of Object.keys(src || {})) {
      const v = src[k];
      if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
        mergeDeep(target[k], v);
      } else {
        target[k] = v;
      }
    }
    return target;
  }

  function textToLines(t) {
    return String(t || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  function linesToText(a) { return (a || []).join("\n"); }

  function syncSettingsToUI() {
    // Exercise
    if (PRESET_EXERCISES.includes(settings.exercise)) {
      el.exercisePreset.value = settings.exercise;
      el.exerciseCustomRow.hidden = true;
      el.exerciseName.value = "";
    } else {
      el.exercisePreset.value = "__custom__";
      el.exerciseCustomRow.hidden = false;
      el.exerciseName.value = settings.exercise || "";
    }

    // Numeric
    setPair(el.sets, el.setsRange, settings.sets);
    setPair(el.reps, el.repsRange, settings.reps);
    setPair(el.bridgeSec, el.bridgeSecRange, settings.bridgeSec);
    setPair(el.restSec, el.restSecRange, settings.restSec);
    setPair(el.breakSec, el.breakSecRange, settings.breakSec);
    setPair(el.prepareSec, el.prepareSecRange, settings.prepareSec);

    el.voiceRate.value = Number(settings.voiceRate).toFixed(2);
    el.voiceRateRange.value = settings.voiceRate;
    el.voicePitch.value = Number(settings.voicePitch).toFixed(2);
    el.voicePitchRange.value = settings.voicePitch;
    el.encourage.checked = !!settings.encourage;
    el.beeps.checked = !!settings.beeps;

    el.msgMid.value = linesToText(settings.messages.mid);
    el.msgHalf.value = linesToText(settings.messages.half);
    el.msgSetEnd.value = linesToText(settings.messages.setEnd);
    el.msgStart.value = settings.messages.start;
    el.msgRepStart.value = settings.messages.repStart;
    el.msgRepEnd.value = settings.messages.repEnd;
    el.msgDone.value = settings.messages.done;

    updateCounters();
    updateTitle();
  }

  function setPair(numberEl, rangeEl, v) {
    numberEl.value = v;
    if (rangeEl) rangeEl.value = clamp(v, Number(rangeEl.min), Number(rangeEl.max));
  }

  function bindNumeric(numberEl, rangeEl, key, opts) {
    const min = opts?.min ?? 0;
    const max = opts?.max ?? Infinity;
    const step = opts?.step ?? 1;
    const isFloat = opts?.float === true;

    const commit = (raw) => {
      let v = isFloat ? parseFloat(raw) : parseInt(raw, 10);
      if (Number.isNaN(v)) v = settings[key];
      v = clamp(v, min, max);
      if (!isFloat) v = Math.round(v / step) * step;
      settings[key] = v;
      numberEl.value = isFloat ? Number(v).toFixed(2) : v;
      if (rangeEl) rangeEl.value = clamp(v, Number(rangeEl.min), Number(rangeEl.max));
      saveSettings();
      updateCounters();
    };
    numberEl.addEventListener("input", () => commit(numberEl.value));
    numberEl.addEventListener("blur", () => commit(numberEl.value));
    if (rangeEl) rangeEl.addEventListener("input", () => commit(rangeEl.value));
  }

  bindNumeric(el.sets, el.setsRange, "sets", { min: 1, max: 20 });
  bindNumeric(el.reps, el.repsRange, "reps", { min: 1, max: 99 });
  bindNumeric(el.bridgeSec, el.bridgeSecRange, "bridgeSec", { min: 1, max: 600 });
  bindNumeric(el.restSec, el.restSecRange, "restSec", { min: 0, max: 600 });
  bindNumeric(el.breakSec, el.breakSecRange, "breakSec", { min: 0, max: 600 });
  bindNumeric(el.prepareSec, el.prepareSecRange, "prepareSec", { min: 0, max: 60 });
  bindNumeric(el.voiceRate, el.voiceRateRange, "voiceRate", { min: 0.5, max: 2, step: 0.05, float: true });
  bindNumeric(el.voicePitch, el.voicePitchRange, "voicePitch", { min: 0.5, max: 2, step: 0.05, float: true });

  el.encourage.addEventListener("change", () => { settings.encourage = el.encourage.checked; saveSettings(); });
  el.beeps.addEventListener("change", () => { settings.beeps = el.beeps.checked; saveSettings(); });
  el.voiceSelect.addEventListener("change", () => {
    settings.voiceURI = el.voiceSelect.value;
    selectedVoice = voices.find((v) => v.voiceURI === settings.voiceURI) || selectedVoice;
    saveSettings();
  });
  el.voiceTest.addEventListener("click", () => {
    speak(`안녕하세요. ${settings.exercise} 타이머 음성 테스트입니다.`, { priority: true });
  });

  // Exercise selection
  el.exercisePreset.addEventListener("change", () => {
    const v = el.exercisePreset.value;
    if (v === "__custom__") {
      el.exerciseCustomRow.hidden = false;
      el.exerciseName.value = settings.exercise && !PRESET_EXERCISES.includes(settings.exercise) ? settings.exercise : "";
      el.exerciseName.focus();
      if (el.exerciseName.value) {
        settings.exercise = el.exerciseName.value;
      }
    } else {
      el.exerciseCustomRow.hidden = true;
      settings.exercise = v;
    }
    saveSettings();
    updateTitle();
    render();
  });
  el.exerciseName.addEventListener("input", () => {
    const v = el.exerciseName.value.trim();
    if (v) {
      settings.exercise = v;
      saveSettings();
      updateTitle();
      render();
    }
  });

  // Message editors
  el.msgMid.addEventListener("input", () => { settings.messages.mid = textToLines(el.msgMid.value); saveSettings(); });
  el.msgHalf.addEventListener("input", () => { settings.messages.half = textToLines(el.msgHalf.value); saveSettings(); });
  el.msgSetEnd.addEventListener("input", () => { settings.messages.setEnd = textToLines(el.msgSetEnd.value); saveSettings(); });
  el.msgStart.addEventListener("input", () => { settings.messages.start = el.msgStart.value; saveSettings(); });
  el.msgRepStart.addEventListener("input", () => { settings.messages.repStart = el.msgRepStart.value; saveSettings(); });
  el.msgRepEnd.addEventListener("input", () => { settings.messages.repEnd = el.msgRepEnd.value; saveSettings(); });
  el.msgDone.addEventListener("input", () => { settings.messages.done = el.msgDone.value; saveSettings(); });

  el.resetDefaults.addEventListener("click", () => {
    if (!confirm("모든 설정을 기본값으로 되돌립니다. 계속할까요?")) return;
    settings = deepClone(DEFAULTS);
    saveSettings();
    syncSettingsToUI();
    reset();
  });

  el.startBtn.addEventListener("click", start);
  el.pauseBtn.addEventListener("click", pause);
  el.resetBtn.addEventListener("click", reset);
  el.settingsBtn.addEventListener("click", () => {
    if (typeof el.dialog.showModal === "function") el.dialog.showModal();
    else el.dialog.setAttribute("open", "");
  });

  syncSettingsToUI();
  reset();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
