/* 졸라맨 런 — 아케이드 횡스크롤 러너
 * 순수 Canvas 2D + WebAudio(사운드는 전부 코드로 합성). 외부 에셋 없음.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // 기본 설정
  // ---------------------------------------------------------------------------
  const W = 960, H = 540;
  const GROUND_Y = 440;       // 지면 높이
  const PX = 220;             // 화면에서 졸라맨의 x 위치
  const STAGE_LEN = 600;      // 스테이지 길이 (m)
  const GRAV = 2600;
  const JUMP_V = -760;
  const DJUMP_V = -700;
  const MAX_LIVES = 5;
  const PIX = '"Press Start 2P", monospace';
  const KR = '"Black Han Sans", sans-serif';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const rotateHint = document.getElementById('rotate');

  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const margin = (vw < 700 || vh < 500) ? 0 : 24;
    const s = Math.min((vw - margin * 2) / W, (vh - margin * 2) / H);
    const cw = Math.floor(W * s), ch = Math.floor(H * s);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------------
  // 유틸
  // ---------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const chance = (p) => Math.random() < p;
  function pickWeighted(list) {
    const total = list.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [v, w] of list) { if ((r -= w) <= 0) return v; }
    return list[0][0];
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixRgb = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 무시 */ } },
  };
  const RANK_KEY = 'jollaman.ranking';
  let ranking = store.get(RANK_KEY, []);
  let muted = store.get('jollaman.muted', false);
  const hiScore = () => (ranking[0] ? ranking[0].s : 0);

  // ---------------------------------------------------------------------------
  // 사운드 (WebAudio 합성)
  // ---------------------------------------------------------------------------
  const Sound = (() => {
    let ac = null, master, sfxBus, musicBus, noiseBuf;
    const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.8;
      const comp = ac.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = 0.4; musicBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }

    function env(g, t0, vol, attack, dur) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }

    function tone(o) {
      if (!ac) return;
      const t0 = o.t != null ? o.t : ac.currentTime + (o.at || 0);
      const dur = o.dur || 0.1;
      const osc = ac.createOscillator();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.f, t0);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + (o.slide || dur));
      const g = ac.createGain();
      env(g, t0, o.vol != null ? o.vol : 0.15, o.attack || 0.005, dur);
      osc.connect(g);
      g.connect(o.bus || sfxBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function noise(o) {
      if (!ac) return;
      const t0 = o.t != null ? o.t : ac.currentTime + (o.at || 0);
      const dur = o.dur || 0.1;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const filt = ac.createBiquadFilter();
      filt.type = o.filter || 'highpass';
      filt.frequency.setValueAtTime(o.freq || 1000, t0);
      if (o.freq2) filt.frequency.exponentialRampToValueAtTime(o.freq2, t0 + dur);
      const g = ac.createGain();
      env(g, t0, o.vol != null ? o.vol : 0.15, o.attack || 0.002, dur);
      src.connect(filt); filt.connect(g); g.connect(o.bus || sfxBus);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + 0.03);
    }

    const seq = (notes, step, o) => notes.forEach((n, i) => n && tone({ ...o, f: mtof(n), at: (o.at || 0) + i * step }));

    const sfx = {
      jump() { tone({ type: 'square', f: 260, f2: 640, dur: 0.14, vol: 0.11 }); },
      djump() {
        tone({ type: 'square', f: 520, f2: 1150, dur: 0.12, vol: 0.09 });
        tone({ type: 'triangle', f: 1040, f2: 1800, dur: 0.14, vol: 0.09, at: 0.05 });
      },
      coin(combo) {
        const m = Math.pow(2, Math.min(combo, 14) / 24);   // 콤보가 이어질수록 음이 올라간다
        tone({ type: 'square', f: 988 * m, dur: 0.06, vol: 0.08 });
        tone({ type: 'square', f: 1319 * m, dur: 0.22, vol: 0.08, at: 0.06 });
      },
      gem() { seq([84, 88, 91, 96, 100], 0.045, { type: 'triangle', dur: 0.14, vol: 0.14 }); },
      power() { seq([72, 76, 79, 84, 79, 84, 88, 91], 0.05, { type: 'square', dur: 0.1, vol: 0.07 }); },
      oneUp() { seq([76, 79, 88, 84, 86, 91], 0.09, { type: 'square', dur: 0.12, vol: 0.08 }); },
      stomp() {
        tone({ type: 'square', f: 540, f2: 90, dur: 0.16, vol: 0.14 });
        noise({ freq: 900, dur: 0.08, vol: 0.15, filter: 'lowpass' });
      },
      kill() { tone({ type: 'square', f: 900, f2: 200, dur: 0.12, vol: 0.09 }); noise({ freq: 2000, dur: 0.1, vol: 0.1 }); },
      hurt() {
        tone({ type: 'sawtooth', f: 440, f2: 90, dur: 0.45, vol: 0.16 });
        noise({ freq: 500, dur: 0.25, vol: 0.2, filter: 'lowpass' });
      },
      fall() { tone({ type: 'triangle', f: 900, f2: 70, dur: 0.9, vol: 0.2 }); },
      slide() { noise({ freq: 3000, freq2: 500, dur: 0.22, vol: 0.09, filter: 'bandpass' }); },
      land() { noise({ freq: 280, dur: 0.05, vol: 0.07, filter: 'lowpass' }); },
      ready() { tone({ type: 'square', f: mtof(72), dur: 0.12, vol: 0.1 }); },
      go() { tone({ type: 'square', f: mtof(84), dur: 0.35, vol: 0.12 }); tone({ type: 'square', f: mtof(79), dur: 0.35, vol: 0.06 }); },
      select() { tone({ type: 'square', f: 880, dur: 0.05, vol: 0.08 }); tone({ type: 'square', f: 1760, dur: 0.1, vol: 0.08, at: 0.05 }); },
      pause() { tone({ type: 'square', f: 660, dur: 0.08, vol: 0.08 }); tone({ type: 'square', f: 440, dur: 0.12, vol: 0.08, at: 0.08 }); },
      stage() {
        seq([72, 72, 72, 76, 79, null, 76, 79, 84], 0.09, { type: 'square', dur: 0.14, vol: 0.09 });
        seq([60, null, null, 64, 67, null, 64, 67, 72], 0.09, { type: 'triangle', dur: 0.16, vol: 0.14 });
      },
      fever() {
        tone({ type: 'sawtooth', f: 200, f2: 1600, dur: 0.5, vol: 0.08 });
        seq([84, 88, 91, 96, 91, 96, 100, 103], 0.04, { type: 'square', dur: 0.08, vol: 0.07, at: 0.3 });
      },
      gameOver() {
        seq([71, 67, 64, null, 62, 60, 59, 55], 0.16, { type: 'square', dur: 0.2, vol: 0.09 });
        seq([47, 43, 40, null, 38, 36, 35, 31], 0.16, { type: 'triangle', dur: 0.22, vol: 0.16 });
      },
      record() { seq([79, 84, 88, 91, 96, 91, 96], 0.07, { type: 'square', dur: 0.1, vol: 0.08 }); },
    };

    // --- BGM: 16스텝 x 4마디 칩튠 루프 (Am - F - C - G) ---
    const _ = null;
    const MELODY = [
      69, _, 72, _, 76, _, 74, 72, 69, _, 72, _, 74, _, 72, _,
      65, _, 69, _, 72, _, 74, 72, 69, _, 65, _, 67, _, 69, _,
      67, _, 72, _, 76, _, 79, 76, 74, _, 72, _, 74, _, 76, _,
      74, _, 71, _, 67, _, 71, 74, 79, _, 78, _, 74, _, 71, _,
    ];
    const BASS = [45, 41, 48, 43];
    const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const music = { on: false, step: 0, next: 0, bpm: 140, tr: 0, fever: false, timer: null };

    function kick(t) {
      tone({ type: 'sine', f: 160, f2: 40, dur: 0.14, vol: 0.5, t, bus: musicBus });
    }
    function snare(t) {
      noise({ freq: 1800, dur: 0.12, vol: 0.2, t, bus: musicBus });
      tone({ type: 'triangle', f: 220, f2: 120, dur: 0.08, vol: 0.12, t, bus: musicBus });
    }
    function hat(t, v) { noise({ freq: 7000, dur: 0.03, vol: v, t, bus: musicBus }); }

    function playStep(s, t, sd) {
      const bar = s >> 4, i = s & 15, tr = music.tr;
      if (i % 4 === 0) kick(t);
      if (i === 4 || i === 12) snare(t);
      if (i % 2 === 0) hat(t, 0.06); else if (music.fever) hat(t, 0.04);
      if (i % 2 === 0) {
        const n = BASS[bar] + (i % 4 === 2 ? 12 : 0) + tr;
        tone({ type: 'triangle', f: mtof(n), dur: sd * 1.8, vol: 0.32, t, bus: musicBus });
      }
      const m = MELODY[s];
      if (m) tone({ type: 'square', f: mtof(m + tr), dur: sd * 1.9, vol: 0.075, t, bus: musicBus });
      if (music.fever) {
        const ch = CHORDS[bar];
        tone({ type: 'square', f: mtof(ch[i % 3] + 24 + tr), dur: sd * 0.8, vol: 0.035, t, bus: musicBus });
      }
    }

    function schedule() {
      if (!ac || !music.on) return;
      const sd = 60 / music.bpm / 4;
      while (music.next < ac.currentTime + 0.12) {
        playStep(music.step, music.next, sd);
        music.next += sd;
        music.step = (music.step + 1) % 64;
      }
    }

    return {
      init,
      play(name, ...args) { if (ac && sfx[name]) sfx[name](...args); },
      startMusic() {
        if (!ac || music.on) return;
        music.on = true; music.step = 0; music.next = ac.currentTime + 0.08;
        music.timer = setInterval(schedule, 25);
      },
      stopMusic() { music.on = false; clearInterval(music.timer); },
      setTempo(bpm, tr) { music.bpm = bpm; music.tr = tr; },
      setFever(on) { music.fever = on; },
      setMuted(m) { if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.02); },
    };
  })();

  // ---------------------------------------------------------------------------
  // 테마 (스테이지마다 바뀜)
  // ---------------------------------------------------------------------------
  const THEMES = [
    { name: '네온 선셋', skyTop: '#12002b', skyBot: '#7a0a6b', sunA: '#ffe53b', sunB: '#ff2b6d', mtn: '#2a0845', mtnEdge: '#ff2bd6', city: '#1a0433', win: '#ffcc33', edge: '#22f3ff', fill: '#0d0221', grid: '#ff2bd6' },
    { name: '사이버 오션', skyTop: '#000a1f', skyBot: '#004c7a', sunA: '#b3fffb', sunB: '#00a8ff', mtn: '#032b4a', mtnEdge: '#22f3ff', city: '#021a33', win: '#7df9ff', edge: '#ff2bd6', fill: '#010d1f', grid: '#22f3ff' },
    { name: '톡식 정글', skyTop: '#001a0a', skyBot: '#1f6b00', sunA: '#eaff00', sunB: '#39ff14', mtn: '#06330f', mtnEdge: '#39ff14', city: '#03210a', win: '#d4ff3b', edge: '#eaff00', fill: '#011407', grid: '#39ff14' },
    { name: '인페르노', skyTop: '#1a0000', skyBot: '#a31d00', sunA: '#fff3b0', sunB: '#ff4500', mtn: '#3d0600', mtnEdge: '#ff6a00', city: '#2a0300', win: '#ffae00', edge: '#ffd000', fill: '#120100', grid: '#ff4500' },
    { name: '갤럭시', skyTop: '#000000', skyBot: '#2b0a5c', sunA: '#ffffff', sunB: '#b388ff', mtn: '#140833', mtnEdge: '#b388ff', city: '#0c0520', win: '#e0d0ff', edge: '#ffffff', fill: '#05020f', grid: '#b388ff' },
  ].map((t) => {
    const o = { name: t.name };
    for (const k in t) if (k !== 'name') o[k] = hexRgb(t[k]);
    return o;
  });
  const theme = { from: 0, to: 0, mix: 1 };
  const C = {};   // 현재 프레임의 보간된 색
  function setTheme(i) {
    i %= THEMES.length;
    if (i === theme.to) return;
    theme.from = theme.to; theme.to = i; theme.mix = 0;
  }
  function updateColors() {
    const a = THEMES[theme.from], b = THEMES[theme.to];
    for (const k in b) if (k !== 'name') C[k] = mixRgb(a[k], b[k], theme.mix);
  }

  // 배경 요소 (한 번만 생성)
  const stars = Array.from({ length: 110 }, () => ({ x: rand(0, W * 2), y: rand(0, 330), s: rand(1, 2.6), tw: rand(1, 4) }));
  const ridge = Array.from({ length: 30 }, () => rand(50, 170));
  const buildings = [];
  for (let x = 0; x < 1800;) {
    const w = randi(50, 110);
    buildings.push({ x, w, h: randi(50, 170), seed: randi(0, 99) });
    x += w + randi(8, 40);
  }
  const CITY_LOOP = 1800;

  // ---------------------------------------------------------------------------
  // 입력
  // ---------------------------------------------------------------------------
  const input = { jumpBuf: 0, jumpHeld: false, slideHeld: false };
  let isTouch = false;
  const pointerActions = new Map();
  const BTN_PAUSE = { x: W - 48, y: 14, w: 34, h: 34 };
  const BTN_MUTE = { x: W - 92, y: 14, w: 34, h: 34 };
  const SLIDE_ZONE = { x: 0, y: 300, w: 240, h: 240 };

  function jumpDown() {
    Sound.init();
    if (state === 'play') { input.jumpBuf = 0.13; input.jumpHeld = true; }
    else if (state === 'title') startGame();
    else if (state === 'over' && stateT > 1.2) startGame();
    else if (state === 'pause') togglePause();
  }
  function jumpUp() { input.jumpHeld = false; }

  function togglePause() {
    if (state === 'play') {
      state = 'pause'; stateT = 0;
      Sound.stopMusic();
      Sound.play('pause');
    } else if (state === 'pause') {
      state = 'play';
      input.jumpBuf = 0;
      Sound.play('select');
      if (g.readyT <= 0) Sound.startMusic();
    }
  }
  function toggleMute() {
    muted = !muted;
    store.set('jollaman.muted', muted);
    Sound.init();
    Sound.setMuted(muted);
  }
  function toTitle() {
    Sound.stopMusic();
    state = 'title'; stateT = 0;
    newRun(true);
  }

  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'KeyZ'];
  const SLIDE_KEYS = ['ArrowDown', 'KeyS', 'KeyX'];
  window.addEventListener('keydown', (e) => {
    if (JUMP_KEYS.includes(e.code) || SLIDE_KEYS.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (JUMP_KEYS.includes(e.code) || e.code === 'Enter') jumpDown();
    else if (SLIDE_KEYS.includes(e.code)) input.slideHeld = true;
    else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'over' && e.code === 'Escape') toTitle();
      else togglePause();
    } else if (e.code === 'KeyM') toggleMute();
    else if (e.code === 'KeyQ' && state === 'pause') toTitle();
  });
  window.addEventListener('keyup', (e) => {
    if (JUMP_KEYS.includes(e.code) || e.code === 'Enter') jumpUp();
    else if (SLIDE_KEYS.includes(e.code)) input.slideHeld = false;
  });

  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H, w: 1, h: 1 };
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'touch') isTouch = true;
    Sound.init();
    const p = toGame(e);
    if (overlap(p, BTN_MUTE)) { toggleMute(); return; }
    if (overlap(p, BTN_PAUSE) && (state === 'play' || state === 'pause')) { togglePause(); return; }
    if (state === 'pause' && p.y > 330 && p.y < 380) { toTitle(); return; }
    if (state === 'play' && isTouch && overlap(p, SLIDE_ZONE)) {
      pointerActions.set(e.pointerId, 'slide');
      input.slideHeld = true;
    } else {
      pointerActions.set(e.pointerId, 'jump');
      jumpDown();
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  });
  const release = (e) => {
    const a = pointerActions.get(e.pointerId);
    pointerActions.delete(e.pointerId);
    if (a === 'slide') input.slideHeld = [...pointerActions.values()].includes('slide');
    else if (a === 'jump') input.jumpHeld = [...pointerActions.values()].includes('jump');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  rotateHint.addEventListener('pointerdown', () => rotateHint.classList.remove('show'));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'play') togglePause();
  });

  // ---------------------------------------------------------------------------
  // 게임 상태
  // ---------------------------------------------------------------------------
  let state = 'title';
  let stateT = 0;
  let time = 0;
  let credits = 0;
  let g = null;

  function newRun(demo) {
    g = {
      demo,
      camX: 0, speed: demo ? 300 : 330, dist: 0, score: 0, coins: 0, lives: 3,
      stage: 1, fever: 0, feverT: 0, feverBridge: false,
      combo: 0, comboT: 0, maxCombo: 0,
      star: 0, magnet: 0, x2: 0,
      p: { y: GROUND_Y, prevY: GROUND_Y, vy: 0, onGround: true, jumps: 0, coyote: 0, sliding: false,
        invT: 0, phase: 0, spin: 0, trail: [], trailT: 0 },
      grounds: [{ x1: -600, x2: 1500 }], platforms: [], coinList: [], items: [], enemies: [],
      particles: [], popups: [],
      genX: 1500, shake: 0, flash: 0, banner: null, readyT: 0, rankPos: -1, newRecord: false,
    };
    // 튜토리얼 구간 코인
    coinRow(700, GROUND_Y - 36, 8);
    coinArc(1080, 1400, GROUND_Y - 40, 110, 6);
    generate();
    setTheme(0);
  }

  function startGame() {
    credits = Math.min(99, credits + 1);
    newRun(false);
    state = 'play'; stateT = 0;
    g.readyT = 1.6;
    input.jumpBuf = 0; input.jumpHeld = false;
    Sound.stopMusic();
    Sound.setTempo(140, 0);
    Sound.setFever(false);
    Sound.play('select');
    Sound.play('ready');
  }

  // ---------------------------------------------------------------------------
  // 레벨 생성 (청크 단위 절차적 생성)
  // ---------------------------------------------------------------------------
  function coinRow(x, y, n, gap = 36) {
    for (let i = 0; i < n; i++) g.coinList.push({ x: x + i * gap, y, t: rand(0, 6) });
  }
  function coinArc(x1, x2, baseY, peak, n) {
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      g.coinList.push({ x: x1 + (x2 - x1) * k, y: baseY - Math.sin(Math.PI * k) * peak, t: rand(0, 6) });
    }
  }
  function randomItem() {
    return pickWeighted([
      ['gem', 2.2], ['magnet', 1.5], ['star', 1.1], ['x2', 1.2], ['heart', g.lives < 3 ? 1.6 : 0.6],
    ]);
  }
  function addItem(x, y, type) { g.items.push({ x, y, type: type || randomItem(), t: rand(0, 6) }); }
  function addEnemy(o) { g.enemies.push({ t: rand(0, 6), dead: false, vy: 0, rot: 0, ...o }); }

  const lastGround = () => g.grounds[g.grounds.length - 1];
  function extend(L) { const x0 = g.genX; lastGround().x2 += L; g.genX = lastGround().x2; return x0; }
  function gapThen(G, L) { const x0 = g.genX + G; g.grounds.push({ x1: x0, x2: x0 + L }); g.genX = x0 + L; return x0; }

  function addChunk() {
    const d = g.stage;
    const sp = Math.sqrt(g.speed / 330);
    const type = g.demo
      ? pickWeighted([['flat', 2], ['gap', 3], ['platforms', 1.5]])
      : pickWeighted([
        ['flat', 2.2], ['gap', 3], ['spikes', 2.2], ['slime', 2.2], ['bird', d >= 2 ? 2.2 : 1],
        ['platforms', 2], ['bridge', d >= 2 ? 1.6 : 0.5], ['gauntlet', d >= 3 ? 1.5 : 0],
      ]);

    switch (type) {
      case 'flat': {
        const L = rand(260, 420), x0 = extend(L);
        if (chance(0.5)) coinRow(x0 + 60, GROUND_Y - 36, Math.floor((L - 90) / 36));
        else coinArc(x0 + 60, x0 + L - 40, GROUND_Y - 40, 100, 6);
        if (!g.demo && chance(0.15)) addItem(x0 + L / 2, GROUND_Y - 170);
        break;
      }
      case 'gap': {
        const gs = g.genX;
        const G = rand(100, Math.min(100 + 28 * d, 240)) * sp;
        const x0 = gapThen(G, rand(300, 420));
        coinArc(gs - 10, x0 + 10, GROUND_Y - 44, 120, 6);
        if (!g.demo && d >= 3 && chance(0.35)) {
          const gs2 = g.genX;
          const x1 = gapThen(rand(110, 170) * sp, rand(300, 380));
          coinArc(gs2 - 10, x1 + 10, GROUND_Y - 44, 120, 5);
        }
        break;
      }
      case 'spikes': {
        const L = rand(420, 560), x0 = extend(L);
        const n = 1 + (d >= 2 && chance(0.5) ? 1 : 0) + (d >= 4 && chance(0.4) ? 1 : 0);
        const cx = x0 + L * 0.55;
        for (let i = 0; i < n; i++) addEnemy({ type: 'spike', x: cx + i * 40, y: GROUND_Y, w: 32, h: 22 });
        coinArc(cx - 90, cx + (n - 1) * 40 + 90, GROUND_Y - 50, 110 + n * 10, 5 + n);
        break;
      }
      case 'slime': {
        const L = rand(460, 620), x0 = extend(L);
        const n = 1 + (d >= 2 && chance(0.5) ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const x = x0 + 220 + i * 150;
          addEnemy({ type: 'slime', x, y: GROUND_Y, w: 34, h: 26, vx: -50, minX: x - 70, maxX: x + 70,
            color: ['#39ff14', '#ff2bd6', '#ffae00', '#22f3ff'][randi(0, 3)] });
        }
        coinRow(x0 + 200, GROUND_Y - 150, 5);
        break;
      }
      case 'bird': {
        const L = rand(540, 700), x0 = extend(L);
        const high = d >= 3 && chance(0.4);
        addEnemy({ type: 'bird', x: x0 + L * 0.75, y: high ? GROUND_Y - 110 : GROUND_Y - 46, baseY: high ? GROUND_Y - 110 : GROUND_Y - 46,
          bob: high ? 34 : 5, w: 36, h: 22, vx: -130 - d * 10 });
        if (!high) coinRow(x0 + 120, GROUND_Y - 18, Math.floor((L - 200) / 40), 40);   // 슬라이딩 보너스
        break;
      }
      case 'platforms': {
        const L = rand(580, 740), x0 = extend(L);
        const p1 = { x: x0 + 80, y: GROUND_Y - 100, w: 150 };
        const p2 = { x: x0 + 300, y: GROUND_Y - 190, w: 160 };
        g.platforms.push(p1, p2);
        coinRow(p1.x + 20, p1.y - 26, 4);
        coinRow(p2.x + 20, p2.y - 26, 4);
        if (!g.demo) {
          if (chance(0.55)) addItem(p2.x + p2.w / 2, p2.y - 70);
          if (d >= 2 && chance(0.45)) {
            const x = x0 + 330;
            addEnemy({ type: 'slime', x, y: GROUND_Y, w: 34, h: 26, vx: -50, minX: x - 60, maxX: x + 60, color: '#ffae00' });
          }
        }
        break;
      }
      case 'bridge': {
        const gs = g.genX;
        const G = rand(380, 500) * Math.min(sp, 1.15);
        const pl = { x: gs + G / 2 - 70, y: GROUND_Y - 90, w: 140 };
        g.platforms.push(pl);
        gapThen(G, rand(320, 420));
        coinArc(gs - 10, pl.x + 20, GROUND_Y - 50, 80, 4);
        coinRow(pl.x + 30, pl.y - 26, 3);
        coinArc(pl.x + pl.w - 20, gs + G + 10, GROUND_Y - 110, 60, 4);
        if (chance(0.3)) addItem(pl.x + pl.w / 2, pl.y - 140, 'gem');
        break;
      }
      case 'gauntlet': {
        // 스파이크 → 슬라임 → 새가 연속으로 나오는 고난도 구간
        const L = rand(760, 900), x0 = extend(L);
        addEnemy({ type: 'spike', x: x0 + 180, y: GROUND_Y, w: 32, h: 22 });
        const sx = x0 + 420;
        addEnemy({ type: 'slime', x: sx, y: GROUND_Y, w: 34, h: 26, vx: -60, minX: sx - 50, maxX: sx + 50, color: '#ff2bd6' });
        addEnemy({ type: 'bird', x: x0 + L + 200, y: GROUND_Y - 46, baseY: GROUND_Y - 46, bob: 5, w: 36, h: 22, vx: -150 });
        coinArc(x0 + 100, x0 + 260, GROUND_Y - 50, 110, 5);
        addItem(x0 + 420, GROUND_Y - 200);
        break;
      }
    }
  }

  function generate() {
    while (g.genX < g.camX + W + 700) addChunk();
  }

  function cleanup() {
    const minX = g.camX - 300;
    g.grounds = g.grounds.filter((s) => s.x2 > minX);
    g.platforms = g.platforms.filter((p) => p.x + p.w > minX);
    g.coinList = g.coinList.filter((c) => !c.taken && c.x > minX);
    g.items = g.items.filter((i) => !i.taken && i.x > minX);
    g.enemies = g.enemies.filter((e) => e.x > minX && !(e.dead && e.y > H + 100));
    g.particles = g.particles.filter((p) => p.life > 0);
    g.popups = g.popups.filter((p) => p.life > 0);
  }

  // ---------------------------------------------------------------------------
  // 이펙트
  // ---------------------------------------------------------------------------
  function burst(x, y, color, n = 10, speed = 260, size = 4) {
    if (g.particles.length > 500) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(speed * 0.3, speed);
      g.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: rand(0.35, 0.7), max: 0.7, color, size, grav: 600 });
    }
  }
  function dust(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      g.particles.push({ x: x + rand(-10, 10), y, vx: rand(-120, 20), vy: rand(-80, -20), life: rand(0.25, 0.45), max: 0.45, color: 'rgba(255,255,255,0.6)', size: rand(3, 6), grav: 0, round: true });
    }
  }
  function ring(x, y, color) {
    g.particles.push({ x, y, vx: 0, vy: 0, life: 0.4, max: 0.4, color, ring: true, grav: 0 });
  }
  function popup(x, y, text, color = '#fff', size = 14) {
    g.popups.push({ x, y, text, color, size, life: 0.9 });
  }
  function banner(text, sub, color) { g.banner = { text, sub, color, t: 0 }; }
  function sfx(name, ...a) { if (!g.demo) Sound.play(name, ...a); }

  // ---------------------------------------------------------------------------
  // 점수 / 콤보 / 피버
  // ---------------------------------------------------------------------------
  const scoreMult = () => (g.x2 > 0 || g.feverT > 0 ? 2 : 1);
  const comboMult = () => Math.min(5, 1 + Math.floor(g.combo / 10));
  function addScore(n) { if (!g.demo) g.score += n * scoreMult(); }
  function addCombo() {
    g.combo++; g.comboT = 1.4;
    g.maxCombo = Math.max(g.maxCombo, g.combo);
    if (g.combo > 0 && g.combo % 10 === 0 && !g.demo) {
      popup(g.camX + PX, g.p.y - 100, `${g.combo} COMBO!`, '#ffe53b', 16);
    }
  }
  function addFever(n) {
    if (g.demo || g.feverT > 0) return;
    g.fever = Math.min(100, g.fever + n);
    if (g.fever >= 100) startFever();
  }
  function startFever() {
    g.fever = 0; g.feverT = 6; g.feverBridge = true; g.flash = 0.4;
    banner('FEVER TIME!!', '무적 + 점수 2배 + 자석', '#ffe53b');
    sfx('fever');
    Sound.setFever(true);
  }
  function lifeUp() {
    const px = g.camX + PX;
    if (g.lives < MAX_LIVES) {
      g.lives++;
      popup(px, g.p.y - 90, '1UP!', '#39ff14', 18);
      sfx('oneUp');
    } else {
      addScore(1000);
      popup(px, g.p.y - 90, '+1000', '#39ff14', 16);
      sfx('gem');
    }
  }

  function collectCoin(c) {
    c.taken = true;
    g.coins++;
    addCombo();
    const pts = 10 * comboMult();
    addScore(pts);
    addFever(2.5);
    sfx('coin', g.combo);
    burst(c.x, c.y, '#ffe53b', 6, 180, 3);
    if (g.coins % 100 === 0 && !g.demo) lifeUp();
  }

  function collectItem(it) {
    it.taken = true;
    const px = g.camX + PX, y = g.p.y - 80;
    ring(it.x, it.y, '#ffffff');
    burst(it.x, it.y, '#ffffff', 14, 300, 4);
    switch (it.type) {
      case 'gem': addScore(500); addFever(12); addCombo(); popup(px, y, '+500', '#22f3ff', 16); sfx('gem'); break;
      case 'star': g.star = 7; popup(px, y, 'STAR POWER!', '#ffe53b', 16); sfx('power'); break;
      case 'magnet': g.magnet = 10; popup(px, y, 'MAGNET!', '#ff5577', 16); sfx('power'); break;
      case 'x2': g.x2 = 12; popup(px, y, 'SCORE x2!', '#22f3ff', 16); sfx('power'); break;
      case 'heart': lifeUp(); break;
    }
  }

  function stageUp(st) {
    g.stage = st;
    setTheme(st - 1);
    banner(`STAGE ${st}`, THEMES[(st - 1) % THEMES.length].name, '#22f3ff');
    addScore(1000 * (st - 1));
    Sound.play('stage');
    Sound.setTempo(Math.min(180, 140 + (st - 1) * 7), [0, 3, 5, -2, 7][(st - 1) % 5]);
  }

  // ---------------------------------------------------------------------------
  // 피격 / 사망
  // ---------------------------------------------------------------------------
  function hurt() {
    const p = g.p;
    g.lives--;
    g.combo = 0;
    p.invT = 1.8;
    g.shake = 0.45;
    g.flash = 0.25;
    burst(g.camX + PX, p.y - 30, '#ff3355', 16, 320, 5);
    if (g.lives <= 0) { die(false); return; }
    sfx('hurt');
    popup(g.camX + PX, p.y - 90, 'OUCH!', '#ff3355', 16);
    p.vy = Math.min(p.vy, -420);
    p.onGround = false;
    p.jumps = 1;
  }

  function fallOut() {
    if (g.demo) { respawn(); return; }
    g.lives--;
    g.combo = 0;
    Sound.play('fall');
    if (g.lives <= 0) { die(true); return; }
    respawn();
  }

  function respawn() {
    const p = g.p;
    const px = g.camX + PX;
    const seg = g.grounds.find((s) => s.x2 > px + 150) || lastGround();
    const nx = Math.max(seg.x1 + 60, px);
    g.camX = nx - PX;
    g.enemies = g.enemies.filter((e) => e.x < nx - 80 || e.x > nx + 520);
    p.y = GROUND_Y - 260; p.prevY = p.y; p.vy = 0; p.jumps = 1;
    p.invT = 2.2; p.sliding = false;
    g.flash = 0.2;
    generate();
  }

  function die(fell) {
    state = 'dying'; stateT = 0;
    Sound.stopMusic();
    Sound.setFever(false);
    const p = g.p;
    p.vy = fell ? 0 : -720;
    p.dead = true;
    p.fell = fell;
    if (!fell) Sound.play('hurt');
  }

  function toGameOver() {
    state = 'over'; stateT = 0;
    const prevHi = hiScore();
    const entry = { s: g.score, d: g.dist, c: g.coins, at: Date.now() };
    ranking.push(entry);
    ranking.sort((a, b) => b.s - a.s);
    ranking = ranking.slice(0, 5);
    store.set(RANK_KEY, ranking);
    g.rankPos = ranking.indexOf(entry);
    g.newRecord = g.score > prevHi && g.score > 0;
    Sound.play(g.newRecord ? 'record' : 'gameOver');
  }

  // ---------------------------------------------------------------------------
  // 업데이트
  // ---------------------------------------------------------------------------
  function playerBox() {
    const p = g.p, px = g.camX + PX;
    return p.sliding
      ? { x: px - 16, y: p.y - 32, w: 34, h: 30 }
      : { x: px - 11, y: p.y - 60, w: 22, h: 58 };
  }

  function update(dt) {
    const p = g.p;
    const px = g.camX + PX;
    const invincible = g.star > 0 || g.feverT > 0;

    // --- 속도 & 거리 ---
    const stageDist = g.dist - (g.stage - 1) * STAGE_LEN;
    const base = g.demo ? 300 : Math.min(660, 330 + (g.stage - 1) * 40 + stageDist / STAGE_LEN * 25);
    const target = base * (g.feverT > 0 ? 1.3 : 1);
    g.speed += (target - g.speed) * Math.min(1, dt * 2);
    g.camX += g.speed * dt;

    const nd = Math.floor(g.camX / 10);
    if (nd > g.dist) {
      if (!g.demo) g.score += (nd - g.dist) * scoreMult();
      g.dist = nd;
    }
    if (!g.demo) {
      const st = 1 + Math.floor(g.dist / STAGE_LEN);
      if (st > g.stage) stageUp(st);
    }

    // --- 타이머 ---
    if (g.comboT > 0 && (g.comboT -= dt) <= 0) g.combo = 0;
    g.star = Math.max(0, g.star - dt);
    g.magnet = Math.max(0, g.magnet - dt);
    g.x2 = Math.max(0, g.x2 - dt);
    p.invT = Math.max(0, p.invT - dt);
    if (g.feverT > 0 && (g.feverT -= dt) <= 0) {
      g.feverT = 0;
      p.invT = Math.max(p.invT, 1.2);
      Sound.setFever(false);
    }

    // --- 데모(타이틀 화면) 자동 조작 ---
    const over = (x) => g.grounds.some((s) => x + 8 > s.x1 && x - 8 < s.x2);
    let wantJump, holdJump;
    if (g.demo) {
      const seg = g.grounds.find((s) => px >= s.x1 && px <= s.x2);
      wantJump = (p.onGround && seg && seg.x2 - px < 40 && p.y === GROUND_Y) ||
        (!p.onGround && p.vy > 60 && p.jumps < 2 && !over(px + 60) && p.y > GROUND_Y - 80);
      holdJump = p.vy < 0;
    } else {
      input.jumpBuf -= dt;
      wantJump = input.jumpBuf > 0;
      holdJump = input.jumpHeld;
    }

    // --- 점프 ---
    if (wantJump) {
      if (p.onGround || p.coyote > 0) {
        p.vy = JUMP_V; p.onGround = false; p.coyote = 0; p.jumps = 1; p.sliding = false;
        input.jumpBuf = 0;
        sfx('jump');
        dust(px, p.y, 5);
      } else if (p.jumps < 2) {
        p.vy = DJUMP_V; p.jumps = 2; p.spin = 0.001;
        input.jumpBuf = 0;
        sfx('djump');
        ring(px, p.y - 10, C.edge);
      }
    }

    // --- 슬라이드 ---
    const slide = !g.demo && input.slideHeld;
    if (slide && p.onGround) {
      if (!p.sliding) { sfx('slide'); dust(px, p.y, 4); }
      p.sliding = true;
    } else {
      p.sliding = false;
    }

    // --- 중력 ---
    let grav = GRAV;
    if (p.vy < 0 && holdJump) grav *= 0.5;
    if (!p.onGround && slide) grav *= 2.4;   // 공중에서 ↓ = 급강하
    p.prevY = p.y;
    p.vy = Math.min(p.vy + grav * dt, 1500);
    p.y += p.vy * dt;
    if (p.spin > 0) { p.spin += dt / 0.4; if (p.spin >= 1) p.spin = 0; }

    // --- 착지 ---
    const wasOnGround = p.onGround;
    const impact = p.vy;
    p.onGround = false;
    if (p.vy >= 0) {
      const bridge = g.feverBridge;
      if ((over(px) || bridge) && p.prevY <= GROUND_Y + 18 && p.y >= GROUND_Y) {
        p.y = GROUND_Y; p.vy = 0; p.onGround = true;
      }
      for (const pl of g.platforms) {
        if (px + 10 > pl.x && px - 10 < pl.x + pl.w && p.prevY <= pl.y + 2 && p.y >= pl.y) {
          p.y = pl.y; p.vy = 0; p.onGround = true;
        }
      }
    }
    if (p.onGround) {
      p.jumps = 0;
      if (!wasOnGround && impact > 300) { sfx('land'); dust(px, p.y, 6); }
    }
    if (wasOnGround && !p.onGround && p.vy >= 0) p.coyote = 0.09;
    else p.coyote = Math.max(0, p.coyote - dt);
    if (g.feverBridge && g.feverT <= 0 && over(px)) g.feverBridge = false;

    // --- 달리기 애니메이션 ---
    p.phase += dt * g.speed * 0.036;
    p.trailT -= dt;
    if (invincible && p.trailT <= 0) {
      p.trailT = 0.035;
      p.trail.push({ x: px, y: p.y, phase: p.phase, sliding: p.sliding, onGround: p.onGround, vy: p.vy, life: 0.25 });
    }
    p.trail.forEach((t) => { t.life -= dt; });
    p.trail = p.trail.filter((t) => t.life > 0);

    if (p.y > H + 80) { fallOut(); return; }

    const pb = playerBox();
    const pcx = px, pcy = p.y - 30;

    // --- 코인 ---
    const magnet = g.magnet > 0 || g.feverT > 0;
    for (const c of g.coinList) {
      if (c.taken) continue;
      c.t += dt;
      if (magnet) {
        const dx = pcx - c.x, dy = pcy - c.y;
        if (dx * dx + dy * dy < 280 * 280 && dx > -200) {
          const k = Math.min(1, dt * 9);
          c.x += dx * k; c.y += dy * k;
        }
      }
      if (overlap(pb, { x: c.x - 11, y: c.y - 11, w: 22, h: 22 })) collectCoin(c);
    }

    // --- 아이템 ---
    for (const it of g.items) {
      if (it.taken) continue;
      it.t += dt;
      const iy = it.y + Math.sin(it.t * 3) * 6;
      if (overlap(pb, { x: it.x - 18, y: iy - 18, w: 36, h: 36 })) collectItem(it);
    }

    // --- 적 ---
    for (const e of g.enemies) {
      e.t += dt;
      if (e.dead) {
        e.vy += GRAV * dt; e.y += e.vy * dt; e.rot += dt * 10;
        continue;
      }
      if (e.type === 'slime') {
        e.x += e.vx * dt;
        if (e.x < e.minX) { e.x = e.minX; e.vx = Math.abs(e.vx); }
        if (e.x > e.maxX) { e.x = e.maxX; e.vx = -Math.abs(e.vx); }
      } else if (e.type === 'bird') {
        e.x += e.vx * dt;
        e.y = e.baseY + Math.sin(e.t * 4) * e.bob;
      }
      if (g.demo) continue;
      const eb = { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h };
      if (!overlap(pb, eb)) continue;
      if (invincible) {
        if (e.type !== 'spike') killEnemy(e, true);
        continue;
      }
      if (e.type !== 'spike' && p.vy > 0 && p.prevY <= eb.y + 14) {
        stomp(e);
      } else if (p.invT <= 0) {
        hurt();
        if (state !== 'play') return;
      }
    }

    generate();
    cleanup();
  }

  function killEnemy(e, byStar) {
    e.dead = true;
    e.vy = -380;
    addCombo();
    const pts = 200 * comboMult();
    addScore(pts);
    addFever(8);
    popup(e.x, e.y - 40, `+${pts * scoreMult()}`, '#ffe53b', 14);
    burst(e.x, e.y - 12, e.color || '#b388ff', 12, 280, 4);
    sfx(byStar ? 'kill' : 'stomp');
  }

  function stomp(e) {
    const p = g.p;
    killEnemy(e, false);
    p.vy = input.jumpHeld ? -820 : -560;
    p.jumps = 1;
    g.shake = Math.max(g.shake, 0.12);
    ring(e.x, e.y - 10, '#ffffff');
  }

  function updateEffects(dt) {
    for (const pt of g.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vy += pt.grav * dt;
    }
    for (const pp of g.popups) { pp.life -= dt; pp.y -= 50 * dt; }
    g.shake = Math.max(0, g.shake - dt);
    g.flash = Math.max(0, g.flash - dt);
    if (g.banner && (g.banner.t += dt) > 2.2) g.banner = null;
  }

  function tick(dt) {
    time += dt;
    stateT += dt;
    if (theme.mix < 1) theme.mix = Math.min(1, theme.mix + dt / 1.5);

    if (state === 'title') {
      update(dt);
      if (stateT > 7) { stateT = 0; setTheme(theme.to + 1); }
      updateEffects(dt);
    } else if (state === 'play') {
      if (g.readyT > 0) {
        const prev = g.readyT;
        g.readyT -= dt;
        if (prev > 0.8 && g.readyT <= 0.8) Sound.play('ready');
        if (g.readyT <= 0) {
          input.jumpBuf = 0;
          banner('GO!', '', '#39ff14');
          Sound.play('go');
          Sound.startMusic();
        }
        g.p.phase += dt * 3;
      } else {
        update(dt);
      }
      updateEffects(dt);
    } else if (state === 'dying') {
      const p = g.p;
      if (stateT > 0.45) { p.vy += GRAV * 0.8 * dt; p.y += p.vy * dt; }
      updateEffects(dt);
      if (stateT > 2) toGameOver();
    } else if (state === 'over') {
      updateEffects(dt);
    }
  }

  // ---------------------------------------------------------------------------
  // 렌더링
  // ---------------------------------------------------------------------------
  function txt(s, x, y, size, color, align = 'left', font = PIX, glow = null) {
    ctx.font = `${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 12; }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    ctx.shadowBlur = 0;
  }
  function outlineTxt(s, x, y, size, fill, stroke, font = PIX, align = 'center', lw = 6) {
    ctx.font = `${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
  }
  const rainbow = (o = 0) => `hsl(${(time * 360 + o) % 360}, 100%, 60%)`;

  function drawBackground(camX) {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, C.skyTop);
    sky.addColorStop(1, C.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, GROUND_Y);

    // 별
    const so = camX * 0.02;
    ctx.fillStyle = '#fff';
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const x = ((s.x - so) % (W * 2) + W * 2) % (W * 2);
      if (x > W) continue;
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(time * s.tw + i));
      ctx.fillRect(x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // 신스웨이브 태양
    const sx = W * 0.68, sy = 300, r = 120;
    const glow = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 1.8);
    glow.addColorStop(0, C.sunB);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = glow;
    ctx.fillRect(sx - r * 2, sy - r * 2, r * 4, r * 4);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.clip();
    const sun = ctx.createLinearGradient(0, sy - r, 0, sy + r);
    sun.addColorStop(0, C.sunA);
    sun.addColorStop(1, C.sunB);
    ctx.fillStyle = sun;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    ctx.fillStyle = C.skyBot;
    for (let i = 0; i < 8; i++) {
      const yy = sy + 4 + i * 15 + (time * 12) % 15;
      ctx.fillRect(sx - r, yy, r * 2, 1.5 + i * 1.1);
    }
    ctx.restore();

    // 먼 산맥
    const spacing = 80, loop = ridge.length * spacing;
    const off = ((camX * 0.08) % loop + loop) % loop;
    const start = Math.floor(off / spacing) - 1;
    ctx.beginPath();
    ctx.moveTo(-10, GROUND_Y);
    for (let i = start; i * spacing - off < W + spacing; i++) {
      ctx.lineTo(i * spacing - off, GROUND_Y - 40 - ridge[((i % ridge.length) + ridge.length) % ridge.length]);
    }
    ctx.lineTo(W + 10, GROUND_Y);
    ctx.closePath();
    ctx.fillStyle = C.mtn;
    ctx.fill();
    ctx.strokeStyle = C.mtnEdge;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 도시 실루엣
    const co = ((camX * 0.3) % CITY_LOOP + CITY_LOOP) % CITY_LOOP;
    for (let rep = 0; rep < 2; rep++) {
      for (const b of buildings) {
        const x = b.x - co + rep * CITY_LOOP;
        if (x > W || x + b.w < 0) continue;
        const top = GROUND_Y - b.h;
        ctx.fillStyle = C.city;
        ctx.fillRect(x, top, b.w, b.h);
        ctx.fillStyle = C.win;
        for (let wy = top + 10, j = 0; wy < GROUND_Y - 10; wy += 16, j++) {
          for (let wx = x + 8, k = 0; wx < x + b.w - 10; wx += 14, k++) {
            if ((j * 7 + k * 13 + b.seed) % 5 === 0) {
              ctx.globalAlpha = 0.5 + 0.4 * Math.sin(time * 0.7 + j + k + b.seed);
              ctx.fillRect(wx, wy, 5, 7);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawGround(camX) {
    // 구덩이(심연)
    const voidG = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    voidG.addColorStop(0, '#05000a');
    voidG.addColorStop(1, '#000');
    ctx.fillStyle = voidG;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    for (const s of g.grounds) {
      const x1 = s.x1 - camX, x2 = s.x2 - camX;
      if (x2 < -20 || x1 > W + 20) continue;
      const cx1 = Math.max(-20, x1), cx2 = Math.min(W + 20, x2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx1, GROUND_Y, cx2 - cx1, H - GROUND_Y);
      ctx.clip();
      ctx.fillStyle = C.fill;
      ctx.fillRect(cx1, GROUND_Y, cx2 - cx1, H - GROUND_Y);
      // 원근 그리드
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      for (const dy of [10, 24, 42, 66, 98]) { ctx.moveTo(cx1, GROUND_Y + dy); ctx.lineTo(cx2, GROUND_Y + dy); }
      const step = 64;
      for (let gx = Math.floor((camX + cx1 - 200) / step) * step; gx - camX < cx2 + 200; gx += step) {
        const x = gx - camX;
        ctx.moveTo(x, GROUND_Y);
        ctx.lineTo(x + (x - W / 2) * 0.9, H);
      }
      ctx.stroke();
      ctx.restore();
      // 네온 가장자리
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = C.edge;
      ctx.fillRect(x1, GROUND_Y - 3, x2 - x1, 10);
      ctx.globalAlpha = 1;
      ctx.fillRect(x1, GROUND_Y, x2 - x1, 3);
      ctx.fillRect(x1, GROUND_Y, 3, H - GROUND_Y);
      ctx.fillRect(x2 - 3, GROUND_Y, 3, H - GROUND_Y);
    }

    if (g.feverBridge) {
      ctx.fillStyle = rainbow();
      ctx.globalAlpha = 0.8;
      ctx.fillRect(0, GROUND_Y, W, 4);
      ctx.globalAlpha = 1;
    }

    for (const pl of g.platforms) {
      const x = pl.x - camX;
      if (x > W || x + pl.w < 0) continue;
      ctx.fillStyle = C.fill;
      ctx.fillRect(x, pl.y, pl.w, 16);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = C.edge;
      ctx.fillRect(x - 3, pl.y - 3, pl.w + 6, 22);
      ctx.globalAlpha = 1;
      ctx.fillRect(x, pl.y, pl.w, 3);
      ctx.strokeStyle = C.edge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, pl.y + 0.75, pl.w - 1.5, 14.5);
    }
  }

  function drawCoin(x, y, t) {
    const w = Math.max(2, 10 * Math.abs(Math.cos(t * 4)));
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#ffe53b';
    ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffb700';
    ctx.beginPath(); ctx.ellipse(x, y, w, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff3a0';
    ctx.beginPath(); ctx.ellipse(x, y, w * 0.55, 6, 0, 0, Math.PI * 2); ctx.fill();
  }

  function heartPath(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.35);
    ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.45, y - s, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.45, y - s, x + s, y - s * 0.4, x, y + s * 0.35);
    ctx.closePath();
  }
  function starPath(x, y, r1, r2, rot = 0) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? r2 : r1, a = rot - Math.PI / 2 + i * Math.PI / 5;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function drawItemIcon(type, x, y, s = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    switch (type) {
      case 'heart':
        ctx.fillStyle = '#ff3355'; heartPath(0, 2, 13); ctx.fill();
        ctx.fillStyle = '#ffb3c0'; ctx.fillRect(-7, -6, 4, 4);
        break;
      case 'star':
        ctx.fillStyle = rainbow(); starPath(0, 0, 14, 6, time * 2); ctx.fill();
        break;
      case 'magnet':
        ctx.lineWidth = 7; ctx.strokeStyle = '#ff3355';
        ctx.beginPath(); ctx.arc(0, -1, 8, Math.PI, 0, true); ctx.stroke();
        ctx.fillStyle = '#ddd'; ctx.fillRect(-11.5, -3, 7, 7); ctx.fillRect(4.5, -3, 7, 7);
        break;
      case 'x2':
        txt('x2', 1, -7, 13, '#22f3ff', 'center');
        break;
      case 'gem':
        ctx.fillStyle = '#22f3ff';
        ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(12, -3); ctx.lineTo(0, 13); ctx.lineTo(-12, -3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b3fffb';
        ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(5, -3); ctx.lineTo(0, 6); ctx.lineTo(-5, -3); ctx.closePath(); ctx.fill();
        break;
    }
    ctx.restore();
  }

  function drawItem(it, camX) {
    const x = it.x - camX, y = it.y + Math.sin(it.t * 3) * 6;
    if (x < -40 || x > W + 40) return;
    const pulse = 1 + Math.sin(time * 6) * 0.06;
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, 24 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 20 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    drawItemIcon(it.type, x, y);
  }

  function drawEnemy(e, camX) {
    const x = e.x - camX;
    if (x < -60 || x > W + 60) return;
    ctx.save();
    ctx.translate(x, e.y);
    if (e.dead) { ctx.translate(0, -12); ctx.rotate(e.rot); ctx.translate(0, 12); ctx.globalAlpha = 0.8; }
    if (e.type === 'slime') {
      const sq = 1 + Math.sin(e.t * 10) * 0.1;
      const w = 20 * sq, h = 26 / sq;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(-w, -h * 1.1, 0, -h);
      ctx.quadraticCurveTo(w, -h * 1.1, w, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(-w * 0.4, -h * 0.7, 4, 3, -0.5, 0, Math.PI * 2); ctx.fill();
      // 눈
      const dir = e.vx < 0 ? -2 : 2;
      ctx.fillStyle = '#fff';
      ctx.fillRect(-9, -h * 0.62, 7, 8); ctx.fillRect(2, -h * 0.62, 7, 8);
      ctx.fillStyle = '#000';
      ctx.fillRect(-7 + dir, -h * 0.55, 3, 5); ctx.fillRect(4 + dir, -h * 0.55, 3, 5);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10, -h * 0.75); ctx.lineTo(-3, -h * 0.66); ctx.moveTo(10, -h * 0.75); ctx.lineTo(3, -h * 0.66); ctx.stroke();
    } else if (e.type === 'bird') {
      const flap = Math.sin(e.t * 18) * 12;
      ctx.translate(0, -11);
      ctx.fillStyle = '#2b0a5c';
      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 6, 0);
        ctx.lineTo(s * 24, -4 + flap);
        ctx.lineTo(s * 16, 4 + flap * 0.4);
        ctx.lineTo(s * 10, 6);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff3355';
      ctx.fillRect(-6, -3, 4, 4); ctx.fillRect(1, -3, 4, 4);
      ctx.fillStyle = '#ffe53b';
      ctx.beginPath(); ctx.moveTo(-10, 2); ctx.lineTo(-17, 4); ctx.lineTo(-10, 6); ctx.fill();
    } else if (e.type === 'spike') {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ff2bd6';
      ctx.fillRect(-22, -6, 44, 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8e8ff';
      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const bx = -20 + i * 13.3;
        ctx.moveTo(bx, 0); ctx.lineTo(bx + 6.6, -24); ctx.lineTo(bx + 13.3, 0);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // 졸라맨: 발 위치(x, y) 기준으로 그림
  function drawJolla(x, y, st, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (st.spin > 0) {
      ctx.translate(0, -32);
      ctx.rotate(st.spin * Math.PI * 2);
      ctx.translate(0, 32);
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const t = st.phase;
    const L = 15;
    let hip, neck, head, limbs;

    const limb = (ox, oy, a1, a2, len) => {
      const kx = ox + Math.sin(a1) * len, ky = oy + Math.cos(a1) * len;
      return [ox, oy, kx, ky, kx + Math.sin(a2) * len, ky + Math.cos(a2) * len];
    };

    if (st.dead) {
      hip = [0, -30]; neck = [0, -48]; head = [0, -60];
      limbs = [
        limb(0, -30, 0.5, 0.3, L), limb(0, -30, -0.5, -0.3, L),
        limb(0, -46, 2.4, 2.8, 12), limb(0, -46, -2.4, -2.8, 12),
      ];
    } else if (st.sliding) {
      hip = [4, -12]; neck = [-16, -24]; head = [-26, -30];
      limbs = [
        limb(4, -12, 1.35, 1.6, L), limb(4, -12, 1.1, 1.5, L),
        limb(-14, -23, 2.6, 2.2, 11), limb(-14, -23, -0.6, 0.3, 11),
      ];
    } else if (!st.onGround) {
      const up = st.vy < 0;
      hip = [0, -30]; neck = [4, -47]; head = [7, -59];
      limbs = up
        ? [limb(0, -30, 1.3, -0.2, L), limb(0, -30, 0.2, -0.6, L), limb(3, -45, 2.6, 3.0, 12), limb(3, -45, -1.2, -0.6, 12)]
        : [limb(0, -30, 0.5, 0.1, L), limb(0, -30, -0.3, -0.1, L), limb(3, -45, 1.9, 2.4, 12), limb(3, -45, -1.9, -2.4, 12)];
    } else if (st.idle) {
      const b = Math.sin(t) * 1.5;
      hip = [0, -30 + b]; neck = [0, -47 + b]; head = [0, -59 + b];
      limbs = [
        limb(0, -30 + b, 0.2, 0.05, L), limb(0, -30 + b, -0.2, -0.05, L),
        limb(0, -45 + b, 0.35, 0.2, 12), limb(0, -45 + b, -0.35, -0.2, 12),
      ];
    } else {
      const bob = Math.abs(Math.sin(t)) * 3;
      hip = [0, -30 - bob]; neck = [5, -47 - bob]; head = [8, -59 - bob];
      limbs = [];
      for (const off of [0, Math.PI]) {
        const a = Math.sin(t + off) * 0.85;
        const bend = Math.max(0, -Math.cos(t + off)) * 1.3;
        limbs.push(limb(0, -30 - bob, a, a - bend, L));
      }
      for (const off of [Math.PI, 0]) {
        const a = Math.sin(t + off) * 0.9;
        limbs.push(limb(4, -45 - bob, a, a + 1.2, 11));
      }
    }

    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(neck[0], neck[1]);
    for (const l of limbs) { ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.lineTo(l[4], l[5]); }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(head[0], head[1], 10.5, 0, Math.PI * 2);
    ctx.fill();

    // 빨간 머리띠 (졸라맨의 상징!)
    ctx.strokeStyle = '#ff3355';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(head[0] - 10, head[1] - 3);
    ctx.lineTo(head[0] + 10, head[1] - 3);
    ctx.stroke();
    ctx.lineWidth = 3;
    const wv = Math.sin(time * 22);
    ctx.beginPath();
    ctx.moveTo(head[0] - 9, head[1] - 3);
    ctx.quadraticCurveTo(head[0] - 18, head[1] - 6 + wv * 3, head[0] - 26, head[1] - 2 + wv * 5);
    ctx.moveTo(head[0] - 9, head[1] - 2);
    ctx.quadraticCurveTo(head[0] - 16, head[1] + 1 - wv * 2, head[0] - 23, head[1] + 5 - wv * 4);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(camX) {
    const p = g.p;
    const invincible = g.star > 0 || g.feverT > 0;
    for (const tr of p.trail) {
      drawJolla(tr.x - camX, tr.y, { phase: tr.phase, sliding: tr.sliding, onGround: tr.onGround, vy: tr.vy, spin: 0 },
        rainbow(tr.life * 900), tr.life * 1.6);
    }
    if (p.invT > 0 && !invincible && Math.floor(time * 14) % 2 === 0 && state === 'play') return;
    const color = invincible ? rainbow() : '#ffffff';
    ctx.shadowColor = invincible ? color : C.edge;
    ctx.shadowBlur = 14;
    const idle = state === 'play' && g.readyT > 0;
    drawJolla(PX, p.y, { phase: p.phase, sliding: p.sliding, onGround: p.onGround || idle, vy: p.vy, spin: p.spin, idle, dead: p.dead }, color);
    ctx.shadowBlur = 0;
    if (g.magnet > 0 && !invincible) {
      ctx.strokeStyle = 'rgba(255,85,119,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(PX, p.y - 30, 40 + Math.sin(time * 8) * 4, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawEffects(camX) {
    for (const pt of g.particles) {
      const a = Math.max(0, pt.life / pt.max);
      ctx.globalAlpha = a;
      if (pt.ring) {
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(pt.x - camX, pt.y, (1 - a) * 50 + 8, 0, Math.PI * 2); ctx.stroke();
      } else if (pt.round) {
        ctx.fillStyle = pt.color;
        ctx.beginPath(); ctx.arc(pt.x - camX, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x - camX - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      }
    }
    ctx.globalAlpha = 1;
    for (const pp of g.popups) {
      ctx.globalAlpha = Math.min(1, pp.life * 2);
      outlineTxt(pp.text, pp.x - camX, pp.y, pp.size, pp.color, '#000', PIX, 'center', 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawButton(b, draw) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    draw(b.x + b.w / 2, b.y + b.h / 2);
  }
  function drawSystemButtons() {
    drawButton(BTN_MUTE, (cx, cy) => {
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 4); ctx.lineTo(cx - 5, cy - 4); ctx.lineTo(cx + 1, cy - 10);
      ctx.lineTo(cx + 1, cy + 10); ctx.lineTo(cx - 5, cy + 4); ctx.lineTo(cx - 10, cy + 4);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (muted) { ctx.moveTo(cx + 4, cy - 5); ctx.lineTo(cx + 11, cy + 5); ctx.moveTo(cx + 11, cy - 5); ctx.lineTo(cx + 4, cy + 5); }
      else { ctx.arc(cx + 2, cy, 6, -0.9, 0.9); ctx.moveTo(cx + 6, cy - 9); ctx.arc(cx + 2, cy, 10, -0.9, 0.9); }
      ctx.stroke();
    });
    if (state === 'play' || state === 'pause') {
      drawButton(BTN_PAUSE, (cx, cy) => {
        if (state === 'pause') {
          ctx.beginPath(); ctx.moveTo(cx - 6, cy - 9); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx - 6, cy + 9); ctx.closePath(); ctx.fill();
        } else { ctx.fillRect(cx - 8, cy - 9, 5, 18); ctx.fillRect(cx + 3, cy - 9, 5, 18); }
      });
    }
  }

  function drawHUD() {
    const hi = Math.max(hiScore(), g.score);
    txt('SCORE', 20, 16, 11, '#ff2bd6');
    txt(String(g.score).padStart(8, '0'), 20, 32, 18, '#fff', 'left', PIX, '#ff2bd6');
    txt('HI-SCORE', W / 2, 16, 11, '#22f3ff', 'center');
    txt(String(hi).padStart(8, '0'), W / 2, 32, 18, '#fff', 'center', PIX, '#22f3ff');
    txt(`STAGE ${g.stage}  ${g.dist}m`, W / 2, 58, 10, '#ffe53b', 'center');

    // 피버 게이지
    const fx = 20, fy = 60, fw = 190, fh = 12;
    txt('FEVER', fx, fy + 16, 9, g.feverT > 0 ? rainbow() : '#aaa');
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(fx, fy, fw, fh);
    const fr = g.feverT > 0 ? g.feverT / 6 : g.fever / 100;
    if (g.feverT > 0 || g.fever >= 85) ctx.fillStyle = rainbow();
    else {
      const grd = ctx.createLinearGradient(fx, 0, fx + fw, 0);
      grd.addColorStop(0, '#ff2bd6'); grd.addColorStop(1, '#ffe53b');
      ctx.fillStyle = grd;
    }
    ctx.fillRect(fx, fy, fw * fr, fh);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(fx, fy, fw, fh);

    // 파워업 타이머
    const pw = [['star', g.star, 7], ['magnet', g.magnet, 10], ['x2', g.x2, 12]].filter((a) => a[1] > 0);
    pw.forEach(([type, v, max], i) => {
      const x = 34 + i * 44, y = 110;
      if (v < 2 && Math.floor(time * 8) % 2) return;
      drawItemIcon(type, x, y, 0.8);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(x - 14, y + 16, 28, 4);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 14, y + 16, 28 * (v / max), 4);
    });

    // 목숨 & 코인
    const rx = W - 112;
    for (let i = 0; i < MAX_LIVES; i++) {
      ctx.fillStyle = i < g.lives ? '#ff3355' : 'rgba(255,255,255,0.15)';
      heartPath(rx - i * 26, 30, 11);
      ctx.fill();
    }
    drawCoin(rx - 104, 62, time);
    txt(`x${String(g.coins).padStart(3, '0')}`, rx + 10, 55, 14, '#ffe53b', 'right');

    // 콤보
    if (g.combo >= 5) {
      const s = 1 + Math.max(0, g.comboT - 1.1) * 1.5;
      ctx.save();
      ctx.translate(W / 2, 92);
      ctx.scale(s, s);
      outlineTxt(`${g.combo} COMBO`, 0, 0, 16, rainbow(), '#000', PIX, 'center', 5);
      if (comboMult() > 1) outlineTxt(`점수 x${comboMult()}`, 0, 22, 16, '#fff', '#000', KR, 'center', 4);
      ctx.restore();
    }

    // 터치 버튼 안내
    if (isTouch && state === 'play') {
      ctx.globalAlpha = input.slideHeld ? 0.55 : 0.28;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(80, H - 72, 46, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = input.jumpHeld ? 0.55 : 0.28;
      ctx.beginPath(); ctx.arc(W - 80, H - 72, 46, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      txt('▼', 80, H - 90, 22, '#000', 'center', KR);
      txt('슬라이드', 80, H - 60, 13, '#000', 'center', KR);
      txt('▲', W - 80, H - 90, 22, '#000', 'center', KR);
      txt('점프', W - 80, H - 60, 13, '#000', 'center', KR);
    }
  }

  function drawBanner() {
    const b = g.banner;
    if (!b) return;
    const t = b.t;
    const inX = t < 0.25 ? (1 - t / 0.25) * W : (t > 1.9 ? -(t - 1.9) / 0.3 * W : 0);
    ctx.save();
    ctx.translate(inX, 0);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 190, W, b.sub ? 110 : 80);
    ctx.globalAlpha = 1;
    ctx.fillStyle = b.color;
    ctx.fillRect(0, 190, W, 3);
    ctx.fillRect(0, (b.sub ? 300 : 270) - 3, W, 3);
    const scale = 1 + Math.sin(time * 10) * 0.03;
    ctx.translate(W / 2, 205);
    ctx.scale(scale, scale);
    outlineTxt(b.text, 0, 0, 40, b.text.startsWith('FEVER') ? rainbow() : '#fff', b.color, PIX, 'center', 6);
    if (b.sub) outlineTxt(b.sub, 0, 56, 24, b.color, '#000', KR, 'center', 5);
    ctx.restore();
  }

  function panel(x, y, w, h, color) {
    ctx.fillStyle = 'rgba(5,0,15,0.78)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.globalAlpha = 0.3;
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
    ctx.globalAlpha = 1;
  }

  function drawRanking(x, y, highlight) {
    txt('TOP 5', x, y, 14, '#ffe53b', 'center', PIX, '#ffe53b');
    const medals = ['#ffe53b', '#d0d0ff', '#ff9e5e', '#fff', '#fff'];
    for (let i = 0; i < 5; i++) {
      const r = ranking[i];
      const yy = y + 28 + i * 22;
      const hl = i === highlight && Math.floor(time * 6) % 2 === 0;
      const col = hl ? '#39ff14' : medals[i];
      txt(`${i + 1}.`, x - 100, yy, 11, col);
      txt(r ? String(r.s).padStart(7, '0') : '-------', x + 10, yy, 11, col, 'center');
      txt(r ? `${r.d}m` : '', x + 104, yy, 9, col, 'right');
    }
  }

  function drawTitle() {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);

    txt('- JOLLAMAN ARCADE -', W / 2, 36, 12, '#22f3ff', 'center', PIX, '#22f3ff');

    // 로고
    ctx.save();
    const wob = Math.sin(time * 2) * 3;
    ctx.translate(W / 2 - 40, 64 + wob);
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 25;
    outlineTxt('졸라맨', 0, 0, 112, '#fff', '#ff2bd6', KR, 'center', 12);
    ctx.shadowBlur = 0;
    outlineTxt('졸라맨', 0, 0, 112, '#fff', '#ff2bd6', KR, 'center', 5);
    ctx.restore();
    ctx.save();
    ctx.translate(W / 2 + 170, 150 + wob);
    ctx.rotate(-0.12);
    const s = 1 + Math.sin(time * 6) * 0.06;
    ctx.scale(s, s);
    outlineTxt('RUN!', 0, 0, 40, '#ffe53b', '#b30059', PIX, 'center', 8);
    ctx.restore();

    if (Math.floor(time * 2) % 2 === 0) {
      const msg = Math.floor(time / 4) % 2 ? 'INSERT COIN' : (isTouch ? 'TAP TO START' : 'PRESS SPACE TO START');
      outlineTxt(msg, W / 2, 222, 18, '#fff', '#ff2bd6', PIX, 'center', 5);
    }

    panel(270, 262, 360, 158, '#22f3ff');
    const lines = [
      ['점프', 'SPACE · ↑ · 탭 (2단 점프)'],
      ['슬라이드', '↓ 꾹 (공중에선 급강하)'],
      ['공격', '적을 위에서 밟아 처치!'],
      ['피버', '게이지 가득 → 무적 질주'],
      ['기타', 'P 일시정지 · M 소리'],
    ];
    lines.forEach(([k, v], i) => {
      txt(k, 288, 276 + i * 28, 15, '#ffe53b', 'left', KR);
      txt(v, 372, 276 + i * 28, 15, '#fff', 'left', KR);
    });

    panel(650, 262, 280, 158, '#ffe53b');
    drawRanking(790, 276, -1);

    txt(`CREDIT ${String(credits).padStart(2, '0')}`, W - 20, H - 22, 10, '#aaa', 'right');
    txt('© 2026 JOLLAMAN ARCADE', 20, H - 22, 10, '#aaa');
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, W, H);
    outlineTxt('PAUSE', W / 2, 190, 40, '#fff', '#ff2bd6', PIX, 'center', 6);
    if (Math.floor(time * 2) % 2 === 0) txt('SPACE / 탭 : 계속하기', W / 2, 270, 20, '#22f3ff', 'center', KR);
    txt('Q / 여기를 탭 : 타이틀로', W / 2, 340, 18, '#aaa', 'center', KR);
  }

  function drawGameOver() {
    const a = Math.min(1, stateT * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.65 * a})`;
    ctx.fillRect(0, 0, W, H);
    const drop = Math.max(0, 1 - stateT * 2.5) * -120;
    // 글리치 효과
    const gl = Math.random() < 0.08 ? rand(-6, 6) : 0;
    ctx.globalAlpha = 0.6;
    outlineTxt('GAME OVER', W / 2 + 4 + gl, 50 + drop, 48, '#22f3ff', '#22f3ff', PIX, 'center', 1);
    ctx.globalAlpha = 1;
    outlineTxt('GAME OVER', W / 2 + gl * -0.5, 48 + drop, 48, '#ff2bd6', '#fff', PIX, 'center', 3);

    if (g.newRecord && Math.floor(time * 5) % 2 === 0) {
      outlineTxt('★ NEW RECORD! ★', W / 2, 118, 20, rainbow(), '#000', PIX, 'center', 5);
    }

    panel(150, 160, 330, 250, '#ff2bd6');
    const rows = [
      ['SCORE', String(g.score).padStart(8, '0'), '#fff'],
      ['DISTANCE', `${g.dist}m`, '#22f3ff'],
      ['STAGE', String(g.stage), '#ffe53b'],
      ['COINS', String(g.coins), '#ffe53b'],
      ['MAX COMBO', String(g.maxCombo), '#39ff14'],
    ];
    rows.forEach(([k, v, c], i) => {
      if (stateT < 0.4 + i * 0.18) return;
      txt(k, 172, 184 + i * 44, 12, '#aaa');
      txt(v, 458, 180 + i * 44, 18, c, 'right', PIX, c);
    });

    panel(500, 160, 310, 250, '#ffe53b');
    drawRanking(655, 180, g.rankPos);

    if (stateT > 1.2 && Math.floor(time * 2) % 2 === 0) {
      outlineTxt(isTouch ? 'TAP TO RETRY' : 'PRESS SPACE TO RETRY', W / 2, 438, 18, '#fff', '#ff2bd6', PIX, 'center', 5);
    }
    txt('ESC : 타이틀로', W / 2, 480, 15, '#aaa', 'center', KR);
  }

  function render() {
    updateColors();
    const camX = g.camX;
    ctx.save();
    if (g.shake > 0) ctx.translate(rand(-1, 1) * 14 * g.shake, rand(-1, 1) * 14 * g.shake);

    drawBackground(camX);
    drawGround(camX);
    for (const c of g.coinList) {
      if (c.taken) continue;
      const x = c.x - camX;
      if (x > -20 && x < W + 20) drawCoin(x, c.y, c.t);
    }
    for (const it of g.items) if (!it.taken) drawItem(it, camX);
    for (const e of g.enemies) drawEnemy(e, camX);
    drawPlayer(camX);
    drawEffects(camX);

    // 피버 스피드 라인
    if (g.feverT > 0) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 14; i++) {
        const y = (i * 97 + 13) % (GROUND_Y - 20);
        const x = W - ((time * 1800 + i * 263) % (W + 300));
        ctx.fillRect(x, y, 120 + (i % 3) * 60, 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (state === 'title') {
      drawTitle();
    } else {
      if (state !== 'over') drawHUD();
      if (state === 'play' && g.readyT > 0) {
        const msg = g.readyT > 0.8 ? 'READY?' : 'SET...';
        outlineTxt(msg, W / 2, 220, 40, '#fff', '#ff2bd6', PIX, 'center', 7);
      }
      drawBanner();
      if (state === 'pause') drawPause();
      if (state === 'over') drawGameOver();
    }
    drawSystemButtons();

    if (g.flash > 0) {
      ctx.globalAlpha = Math.min(0.7, g.flash * 2.5);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // 메인 루프
  // ---------------------------------------------------------------------------
  newRun(true);
  updateColors();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (state !== 'pause') tick(dt);
    else time += dt;
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
