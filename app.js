"use strict";

/* =========================================================================
   夜间自习室 · app.js
   - 场景生成(星星 / 城市灯光 / 微尘)
   - 时钟 / 考研倒计时 / 励志轮播
   - 番茄钟(自动切换 专注/休息,完成计数,提示音)
   - Web Audio 实时生成 lo-fi 音乐 + 雨声 + 黑胶噪点
   - canvas 雨滴
   ========================================================================= */

/* ↓↓↓ 你只需要改这一行:把日期改成你自己的考研初试日期 ↓↓↓ */
const EXAM_DATE = new Date("2026-12-19T08:30:00");
const EXAM_LABEL = "考研初试";
/* ↑↑↑ 格式 年-月-日,例如 "2026-12-19T08:30:00" ↑↑↑ */

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);

/* ============================== 场景生成 ============================== */
function buildScene() {
  const SVGNS = "http://www.w3.org/2000/svg";
  const stars = $("stars");
  // 星星
  for (let i = 0; i < 70; i++) {
    const c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("cx", rand(20, 1580).toFixed(0));
    c.setAttribute("cy", rand(20, 360).toFixed(0));
    c.setAttribute("r", rand(0.6, 1.8).toFixed(2));
    c.setAttribute("fill", "#fff");
    c.setAttribute("class", "twinkle");
    c.style.setProperty("--d", rand(2, 6).toFixed(2) + "s");
    c.style.animationDelay = rand(0, 4).toFixed(2) + "s";
    stars.appendChild(c);
  }

  // 城市天际线:一排高低不一的楼,带窗户灯光
  const city = $("city");
  let x = -20;
  while (x < 1620) {
    const w = rand(60, 130);
    const h = rand(120, 300);
    const top = 600 - h;
    const b = document.createElementNS(SVGNS, "rect");
    b.setAttribute("x", x.toFixed(0));
    b.setAttribute("y", top.toFixed(0));
    b.setAttribute("width", w.toFixed(0));
    b.setAttribute("height", h.toFixed(0));
    b.setAttribute("fill", Math.random() > 0.5 ? "#160f28" : "#1b1330");
    city.appendChild(b);

    // 窗户灯
    for (let wy = top + 14; wy < 596; wy += 22) {
      for (let wx = x + 10; wx < x + w - 12; wx += 18) {
        if (Math.random() > 0.62) {
          const win = document.createElementNS(SVGNS, "rect");
          win.setAttribute("x", wx.toFixed(0));
          win.setAttribute("y", wy.toFixed(0));
          win.setAttribute("width", "8");
          win.setAttribute("height", "11");
          win.setAttribute("fill", Math.random() > 0.3 ? "#ffcf87" : "#ff9d6b");
          if (Math.random() > 0.7) {
            win.setAttribute("class", "twinkle");
            win.style.setProperty("--d", rand(3, 7).toFixed(2) + "s");
            win.style.animationDelay = rand(0, 5).toFixed(2) + "s";
          }
          city.appendChild(win);
        }
      }
    }
    x += w + rand(2, 10);
  }

  // 漂浮微尘
  const dust = $("dust");
  for (let i = 0; i < 18; i++) {
    const d = document.createElementNS(SVGNS, "circle");
    d.setAttribute("cx", rand(280, 1320).toFixed(0));
    d.setAttribute("cy", rand(620, 760).toFixed(0));
    d.setAttribute("r", rand(1, 2.6).toFixed(2));
    d.setAttribute("class", "dust");
    d.setAttribute("opacity", "0");
    d.style.setProperty("--fx", rand(-30, 30).toFixed(0) + "px");
    d.style.setProperty("--fd", rand(8, 16).toFixed(1) + "s");
    d.style.animationDelay = rand(0, 10).toFixed(1) + "s";
    dust.appendChild(d);
  }
}

/* ============================== 时钟 / 倒计时 / 语录 ============================== */
function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  $("clock").textContent = `${hh}:${mm}`;
  const week = "日一二三四五六"[now.getDay()];
  $("date").textContent =
    `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 周${week}`;

  const ms = EXAM_DATE - now;
  const days = Math.ceil(ms / 86400000);
  $("countdown").textContent =
    days > 0 ? `距 ${EXAM_LABEL} 还有 ${days} 天` :
    days === 0 ? `${EXAM_LABEL}就在今天 · 全力以赴` :
    `愿你已在理想的地方`;
}

const QUOTES = [
  "再坚持一下,西电在等你。",
  "你现在多学的每一分,都是录取线上的余量。",
  "别担心结果,先把这一个番茄钟坐满。",
  "安静地努力,然后惊艳所有人。",
  "上岸的人,只是把今天又重复了一遍。",
  "困了就抬头看看月亮,然后继续。",
  "专注当下这道题,未来会谢谢现在的你。",
];
let qi = 0;
function rotateQuote() {
  const el = $("quote");
  el.style.opacity = 0;
  setTimeout(() => {
    el.textContent = QUOTES[qi % QUOTES.length];
    qi++;
    el.style.opacity = 1;
  }, 600);
}

/* ============================== 番茄钟 ============================== */
const timer = {
  focusMin: 25, breakMin: 5,
  mode: "focus",          // focus | break
  remain: 25 * 60,
  running: false,
  count: 0,
  iv: null,
};
function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}
function renderTimer() {
  $("tTime").textContent = fmt(timer.remain);
  $("tMode").textContent = timer.mode === "focus" ? "专注" : "休息";
  $("tCount").textContent = `🍅 ${timer.count}`;
  $("tStart").textContent = timer.running ? "暂停" : "开始";
  document.title =
    (timer.running ? (timer.mode === "focus" ? "▶ 专注 " : "☕ 休息 ") + fmt(timer.remain) : "夜间自习室") +
    " · lo-fi";
}
function setMode(mode) {
  timer.mode = mode;
  timer.remain = (mode === "focus" ? timer.focusMin : timer.breakMin) * 60;
  renderTimer();
}
function toggleTimer() {
  timer.running = !timer.running;
  if (timer.running) {
    timer.iv = setInterval(() => {
      if (timer.remain > 0) {
        timer.remain--;
        renderTimer();
      } else {
        finishPhase();
      }
    }, 1000);
  } else {
    clearInterval(timer.iv);
  }
  renderTimer();
}
function finishPhase() {
  clearInterval(timer.iv);
  if (timer.mode === "focus") {
    timer.count++;
    chime(true);
    setMode("break");
  } else {
    chime(false);
    setMode("focus");
  }
  // 自动进入下一阶段
  timer.running = true;
  timer.iv = setInterval(() => {
    if (timer.remain > 0) { timer.remain--; renderTimer(); }
    else finishPhase();
  }, 1000);
  renderTimer();
}
function resetTimer() {
  clearInterval(timer.iv);
  timer.running = false;
  setMode(timer.mode);
}
function skipPhase() {
  clearInterval(timer.iv);
  const wasRunning = timer.running;
  timer.running = false;
  if (timer.mode === "focus") setMode("break"); else setMode("focus");
  if (wasRunning) toggleTimer();
}

/* ============================== Web Audio 引擎 ============================== */
const Audio = {
  ctx: null, master: null, musicBus: null, rainGain: null, reverb: null,
  musicOn: true, rainOn: true,
  rainSrc: null,
  // 调度
  tempo: 72, step: 0, bar: 0, nextTime: 0, schedIv: null,
  noiseBuf: null,
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
// ii–V–I–vi(C 大调):Dm7 – G7 – Cmaj7 – Am7
const PROG = [
  [50, 53, 57, 60],  // Dm7
  [55, 59, 62, 65],  // G7
  [48, 52, 55, 59],  // Cmaj7
  [45, 48, 52, 55],  // Am7
];
const PENTA = [69, 72, 74, 76, 79, 81]; // A 小调五声

function makeNoise(seconds) {
  const len = Audio.ctx.sampleRate * seconds;
  const buf = Audio.ctx.createBuffer(1, len, Audio.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function makeImpulse(seconds, decay) {
  const len = Audio.ctx.sampleRate * seconds;
  const buf = Audio.ctx.createBuffer(2, len, Audio.ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function initAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  Audio.ctx = ctx;

  Audio.master = ctx.createGain();
  Audio.master.gain.value = 0.9;
  Audio.master.connect(ctx.destination);

  Audio.musicBus = ctx.createGain();
  Audio.musicBus.gain.value = 0.55;
  Audio.musicBus.connect(Audio.master);

  // 混响
  Audio.reverb = ctx.createConvolver();
  Audio.reverb.buffer = makeImpulse(2.4, 2.2);
  // 低通:滤掉白噪声卷积核带来的高频"沙/电流"毛刺,只留温暖的混响
  const revLP = ctx.createBiquadFilter();
  revLP.type = "lowpass"; revLP.frequency.value = 3200;
  const revGain = ctx.createGain();
  revGain.gain.value = 0.42;
  Audio.reverb.connect(revLP);
  revLP.connect(revGain);
  revGain.connect(Audio.musicBus);
  Audio._revIn = Audio.reverb; // 送入点

  Audio.noiseBuf = makeNoise(2);

  // 雨声:循环噪声 → 带通 → rainGain → master
  Audio.rainGain = ctx.createGain();
  Audio.rainGain.gain.value = 0.45;
  Audio.rainGain.connect(Audio.master);
  startRainNoise();

  // 启动音乐调度
  Audio.nextTime = ctx.currentTime + 0.12;
  Audio.schedIv = setInterval(scheduler, 25);
}

function startRainNoise() {
  const ctx = Audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = Audio.noiseBuf;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 1600;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 420;
  // 缓慢起伏(像雨势变化)
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.frequency.value = 0.08; lfoG.gain.value = 260;
  lfo.connect(lfoG); lfoG.connect(lp.frequency);
  src.connect(hp); hp.connect(lp); lp.connect(Audio.rainGain);
  src.start(); lfo.start();
  Audio.rainSrc = src;
}

/* —— 单音封装 —— */
function tone(freq, t, dur, type, peak, dest, atk, rel) {
  const ctx = Audio.ctx;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + rel + 0.05);
  return g;
}

/* —— 鼓 —— */
function kick(t) {
  const ctx = Audio.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(125, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.13);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g); g.connect(Audio.musicBus);
  o.start(t); o.stop(t + 0.24);
}
function noiseHit(t, dur, peak, hp, lp) {
  const ctx = Audio.ctx;
  const s = ctx.createBufferSource(); s.buffer = Audio.noiseBuf;
  const f1 = ctx.createBiquadFilter(); f1.type = "highpass"; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = "lowpass"; f2.frequency.value = lp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(Audio.musicBus);
  s.start(t); s.stop(t + dur + 0.02);
}

/* —— 调度器(lookahead) —— */
function scheduler() {
  if (!Audio.musicOn) { // 仍推进时间,避免恢复时跳变
    Audio.nextTime = Audio.ctx.currentTime + 0.12;
    return;
  }
  const sec16 = 60 / Audio.tempo / 4;
  while (Audio.nextTime < Audio.ctx.currentTime + 0.2) {
    const swing = (Audio.step % 2 === 1) ? sec16 * 0.18 : 0;
    scheduleStep(Audio.step, Audio.nextTime + swing, sec16);
    Audio.nextTime += sec16;
    Audio.step = (Audio.step + 1) % 16;
    if (Audio.step === 0) Audio.bar++;
  }
}
function scheduleStep(step, t, sec16) {
  const chord = PROG[Audio.bar % PROG.length];

  // 每小节起:铺底和弦 pad
  if (step === 0) {
    const barLen = sec16 * 16;
    chord.forEach((m) => {
      [-0.06, 0.06].forEach((det) => {
        const g = tone(mtof(m) * (1 + det / 12), t, barLen * 0.95,
          "triangle", 0.05, Audio.musicBus, 0.7, 0.5);
        // pad 送一点混响
        g.connect(Audio._revIn);
      });
    });
    // 低音根音
    bassNote(chord[0] - 12, t, barLen * 0.48);
  }
  // 小节中点再补一下低音
  if (step === 8) bassNote(chord[0] - 12, t, sec16 * 8 * 0.46);

  // 鼓:1、3 拍底鼓
  if (step === 0 || step === 8) kick(t);
  // 2、4 拍军鼓(柔)
  if (step === 4 || step === 12) noiseHit(t, 0.18, 0.1, 1200, 6000);
  // 反拍 hi-hat(调暗调轻,减少高频"电流"感)
  if (step % 2 === 1) noiseHit(t, 0.045, 0.02, 5000, 8500);

  // 旋律:稀疏,落在拍点上
  const onBeat = step % 4 === 0;
  if ((onBeat && Math.random() < 0.45) || (!onBeat && Math.random() < 0.12)) {
    const note = PENTA[Math.floor(Math.random() * PENTA.length)] +
      (Math.random() < 0.25 ? 12 : 0);
    const g = tone(mtof(note), t, sec16 * (Math.random() < 0.4 ? 4 : 2),
      "sine", 0.07, Audio.musicBus, 0.02, 0.5);
    g.connect(Audio._revIn);
  }

  // 黑胶噪点(已移除:用户不喜欢这种"滋滋"静电声)
}
function bassNote(m, t, dur) {
  const ctx = Audio.ctx;
  const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); lp.connect(g); g.connect(Audio.musicBus);
  o.start(t); o.stop(t + dur + 0.05);
}

/* —— 番茄钟提示音 —— */
function chime(focusDone) {
  if (!Audio.ctx) return;
  const t = Audio.ctx.currentTime;
  const notes = focusDone ? [72, 76, 79] : [79, 76, 72]; // 完成上行 / 休息结束下行
  notes.forEach((m, i) => {
    const g = tone(mtof(m), t + i * 0.16, 0.4, "sine", 0.16, Audio.master, 0.01, 0.5);
    g.connect(Audio._revIn);
  });
}

/* —— 音量 / 开关 —— */
function setMusicVol(v) {
  if (Audio.musicBus)
    Audio.musicBus.gain.setTargetAtTime(v, Audio.ctx.currentTime, 0.1);
}
function setRainVol(v) {
  if (Audio.rainGain)
    Audio.rainGain.gain.setTargetAtTime(v, Audio.ctx.currentTime, 0.1);
}
function toggleMusic() {
  Audio.musicOn = !Audio.musicOn;
  const btn = $("musicToggle");
  btn.classList.toggle("off", !Audio.musicOn);
  setMusicVol(Audio.musicOn ? $("musicVol").value / 100 : 0);
}
function toggleRain() {
  Audio.rainOn = !Audio.rainOn;
  const btn = $("rainToggle");
  btn.classList.toggle("off", !Audio.rainOn);
  setRainVol(Audio.rainOn ? $("rainVol").value / 100 : 0);
}

/* ============================== 雨滴 canvas ============================== */
function initRainCanvas() {
  const cv = $("rainCanvas");
  const ctx = cv.getContext("2d");
  let drops = [];
  function resize() {
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    const n = Math.floor((cv.width * cv.height) / 9000);
    drops = [];
    for (let i = 0; i < n; i++) {
      drops.push({
        x: Math.random() * cv.width,
        y: Math.random() * cv.height,
        len: rand(8, 22),
        sp: rand(6, 13),
        a: rand(0.06, 0.22),
      });
    }
  }
  resize();
  window.addEventListener("resize", resize);

  function frame() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (Audio.rainOn !== false) {
      ctx.strokeStyle = "#bcd6ff";
      ctx.lineWidth = 1.1;
      for (const d of drops) {
        ctx.globalAlpha = d.a;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 1.5, d.y + d.len);
        ctx.stroke();
        d.y += d.sp; d.x -= 0.6;
        if (d.y > cv.height) { d.y = -d.len; d.x = Math.random() * cv.width; }
      }
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }
  frame();
}

/* ============================== 启动 / 事件绑定 ============================== */
function enter() {
  $("gate").classList.add("gone");
  $("ui").classList.remove("hidden");
  try {
    initAudio();
    if (Audio.ctx.state === "suspended") Audio.ctx.resume();
  } catch (e) {
    console.warn("音频初始化失败:", e);
  }
}

function bindUI() {
  $("enterBtn").addEventListener("click", enter);

  // 番茄钟
  $("tStart").addEventListener("click", toggleTimer);
  $("tReset").addEventListener("click", resetTimer);
  $("tSkip").addEventListener("click", skipPhase);
  $("presets").querySelectorAll(".chip").forEach((c) => {
    c.addEventListener("click", () => {
      $("presets").querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      timer.focusMin = +c.dataset.focus;
      timer.breakMin = +c.dataset.break;
      clearInterval(timer.iv);
      timer.running = false;
      setMode("focus");
    });
  });

  // 声音
  $("musicToggle").addEventListener("click", toggleMusic);
  $("rainToggle").addEventListener("click", toggleRain);
  $("musicVol").addEventListener("input", (e) => {
    if (Audio.musicOn) setMusicVol(e.target.value / 100);
  });
  $("rainVol").addEventListener("input", (e) => {
    if (Audio.rainOn) setRainVol(e.target.value / 100);
  });

  // 全屏
  $("fsBtn").addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // 空格 = 番茄钟开始/暂停(进入后才生效)
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && $("gate").classList.contains("gone")) {
      e.preventDefault(); toggleTimer();
    }
  });
}

function main() {
  buildScene();
  initRainCanvas();
  bindUI();
  renderTimer();
  tickClock();
  setInterval(tickClock, 1000 * 20);
  rotateQuote();
  setInterval(rotateQuote, 1000 * 30);
}
document.addEventListener("DOMContentLoaded", main);
