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
const RAIN_MAX = 0.05; // 雨声(白噪声)最大增益:滑块 100% 时只到此值

/* ============================== 本地存储(刷新不丢:番茄计数/预设/音量) ============================== */
const STORE_KEY = "lofi-study-state";
function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      day: todayKey(),
      count: timer.count,
      focusMin: timer.focusMin,
      breakMin: timer.breakMin,
      musicVol: +$("musicVol").value,
      rainVol: +$("rainVol").value,
      musicOn: Audio.musicOn,
      rainOn: Audio.rainOn,
    }));
  } catch (e) { /* 隐私模式等存储不可用,忽略 */ }
}
function loadState() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch (e) { return {}; }
}
function applySavedState() {
  const st = loadState();
  // 番茄计数:同一天才恢复(跨天自动清零 = "今日番茄");当天刷新不丢
  if (st.day === todayKey() && Number.isFinite(st.count)) timer.count = st.count;
  // 番茄钟预设
  if (st.focusMin && st.breakMin) {
    timer.focusMin = st.focusMin; timer.breakMin = st.breakMin;
    $("presets").querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("active",
        +c.dataset.focus === st.focusMin && +c.dataset.break === st.breakMin));
    setMode("focus");
  }
  // 音量滑块位置
  if (Number.isFinite(st.musicVol)) $("musicVol").value = st.musicVol;
  if (Number.isFinite(st.rainVol)) $("rainVol").value = st.rainVol;
  // 开关(此时音频还没启动,先记状态,enter() 里应用)
  if (st.musicOn === false) { Audio.musicOn = false; $("musicToggle").classList.add("off"); }
  if (st.rainOn === false) { Audio.rainOn = false; $("rainToggle").classList.add("off"); }
}

/* 场景(房间/灯光/家具/夜景/雨)已迁移到 scene3d.js —— Three.js 等距 3D 房间 */

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
  // —— 坚持 / 上岸 ——
  "再坚持一下,西电在等你。",
  "你现在多学的每一分,都是录取线上的余量。",
  "上岸的人,只是把今天又重复了一遍。",
  "安静地努力,然后惊艳所有人。",
  "别人在刷手机的时候,你在拉开差距。",
  "现在的每一道题,都是十二月的底气。",
  "慢一点没关系,别停下就行。",
  "你不是在熬,你是在靠近想去的地方。",
  "三百多天,够把一个普通人变成上岸的人。",
  "坚持到最后的人,运气都不会太差。",
  // —— 专注当下 ——
  "别担心结果,先把这一个番茄钟坐满。",
  "专注当下这道题,未来会谢谢现在的你。",
  "你只需要赢下现在这 25 分钟。",
  "把手机放远一点,把世界关在门外。",
  "进度条不会自己走,但你可以。",
  "一次只做一件事,把它做到底。",
  "不要等状态来了再学,学着学着状态就来了。",
  "现在分心一分钟,等会儿要花十分钟找回状态。",
  "先动笔,情绪会跟上来的。",
  "今天的目标不是学完,是别骗自己。",
  // —— 深夜 / 自我对话 ——
  "困了就抬头看看月亮,然后继续。",
  "夜深了,但你的梦想还醒着。",
  "这盏灯亮着,就说明你还没放弃。",
  "累是对的,说明你在往上走。",
  "没有谁的上岸是轻轻松松的。",
  "熬过这阵子,你会感谢死磕的自己。",
  "雨在下,你在学,这就够浪漫了。",
  "情绪稳一点,题目就没那么难了。",
  "进一寸有进一寸的欢喜。",
  "你想要的,正在另一头等你去拿。",
  // —— 方法 / 心态 ——
  "看不懂就抄一遍,抄不会就背下来。",
  "错题不是耻辱,是你私人订制的提分清单。",
  "学不进去的时候,就从最简单的一题开始。",
  "计划赶不上变化,但有计划的人走得更远。",
  "比起天赋,西电更看你能不能坐得住。",
  "今天偷的懒,都会变成考场上的慌。",
  "状态差也要学,差的状态学一半也比躺着强。",
  "把'我不想学'换成'我先学十分钟'。",
  "别和别人比进度,和昨天的自己比。",
  "你能走到这里,就已经超过了很多放弃的人。",
];
let qi = -1;
function rotateQuote() {
  const el = $("quote");
  el.style.opacity = 0;
  setTimeout(() => {
    let n = qi;
    if (QUOTES.length > 1) while (n === qi) n = Math.floor(Math.random() * QUOTES.length);
    qi = n;
    el.textContent = QUOTES[qi];
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
    saveState();          // 完成一个番茄 → 立即存盘,刷新不丢
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
  Audio.rainGain.gain.value = 0.45 * RAIN_MAX;
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
  // 2、4 拍军鼓(改柔:调暗调轻,从"嚓"变成闷一点的"哒")
  if (step === 4 || step === 12) noiseHit(t, 0.14, 0.05, 700, 2600);
  // 反拍 hi-hat(已移除:用户不喜欢这种"嚓嚓"噪声)

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
    Audio.rainGain.gain.setTargetAtTime(v * RAIN_MAX, Audio.ctx.currentTime, 0.1);
}
function toggleMusic() {
  Audio.musicOn = !Audio.musicOn;
  const btn = $("musicToggle");
  btn.classList.toggle("off", !Audio.musicOn);
  setMusicVol(Audio.musicOn ? $("musicVol").value / 100 : 0);
  saveState();
}
function toggleRain() {
  Audio.rainOn = !Audio.rainOn;
  const btn = $("rainToggle");
  btn.classList.toggle("off", !Audio.rainOn);
  setRainVol(Audio.rainOn ? $("rainVol").value / 100 : 0);
  if (window.Scene3D) Scene3D.setRain(Audio.rainOn); // 联动窗外雨
  saveState();
}

/* 雨改由 scene3d.js 的 3D 粒子实现(随雨声开关显隐,见 toggleRain) */

/* ============================== 启动 / 事件绑定 ============================== */
// 移动端(iOS/微信)音频解锁:必须在用户手势内播放一个静音 buffer 并 resume,
// 否则 AudioContext 一直挂起,听不到声音。
function unlockAudio() {
  const ctx = Audio.ctx;
  if (!ctx) return;
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (e) { /* 忽略 */ }
  if (ctx.state !== "running") ctx.resume();
}

function enter() {
  $("gate").classList.add("gone");
  $("ui").classList.remove("hidden");
  try {
    initAudio();
    unlockAudio();
    // 应用已保存的音量与开关状态(刷新前的设置)
    setMusicVol(Audio.musicOn ? $("musicVol").value / 100 : 0);
    setRainVol(Audio.rainOn ? $("rainVol").value / 100 : 0);
    if (window.Scene3D) Scene3D.setRain(Audio.rainOn);
    // 兜底:有些机型首次手势 resume 不生效,后续任一次触摸/点击再恢复一次
    const kick = () => {
      if (Audio.ctx && Audio.ctx.state !== "running") {
        unlockAudio();
      } else {
        document.removeEventListener("touchend", kick);
        document.removeEventListener("click", kick);
      }
    };
    document.addEventListener("touchend", kick, { passive: true });
    document.addEventListener("click", kick);
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
      saveState();
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
  // 音量拖动结束后存盘(避免拖动过程频繁写入)
  $("musicVol").addEventListener("change", saveState);
  $("rainVol").addEventListener("change", saveState);

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
  if (window.Scene3D) Scene3D.init();
  bindUI();
  applySavedState();   // 恢复上次的番茄计数/预设/音量(刷新不丢)
  renderTimer();
  tickClock();
  setInterval(tickClock, 1000 * 20);
  rotateQuote();
  setInterval(rotateQuote, 1000 * 30);
}
document.addEventListener("DOMContentLoaded", main);
