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
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;   // YYYY-MM-DD(本地与云端通用)
}
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      day: todayKey(),
      count: timer.count,
      focusMin: timer.focusMin,
      breakMin: timer.breakMin,
      mode: timer.mode,
      remain: remainNow(),
      running: timer.running,
      endAt: timer.endAt,
      musicVol: +$("musicVol").value,
      rainVol: +$("rainVol").value,
      musicOn: Audio.musicOn,
      rainOn: Audio.rainOn,
      track: selectedTrackIdx(),
    }));
  } catch (e) { /* 隐私模式等存储不可用,忽略 */ }
  scheduleCloudPush();   // 已登录则同步到云端(防抖)
}

// 云端写入防抖:多次改动合并成一次上传
let cloudTimer = null;
function scheduleCloudPush() {
  if (!(window.Cloud && Cloud.user)) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    Cloud.saveDaily(todayKey(), timer.count);
    Cloud.saveSettings({
      focus_min: timer.focusMin, break_min: timer.breakMin,
      music_vol: +$("musicVol").value, rain_vol: +$("rainVol").value,
      music_on: Audio.musicOn, rain_on: Audio.rainOn,
      track: selectedTrackIdx(),
    });
  }, 800);
}

// 从云端拉取并应用(登录后调用)
async function loadFromCloud() {
  if (!(window.Cloud && Cloud.user)) return;
  const res = await Cloud.load(todayKey());
  if (!res) return;
  // 今日计数取本地/云端较大值,避免离线已完成的番茄被覆盖丢失
  timer.count = Math.max(timer.count || 0, Number.isFinite(res.count) ? res.count : 0);
  const s = res.settings;
  if (s) {
    if (s.focus_min && s.break_min) {
      timer.focusMin = s.focus_min; timer.breakMin = s.break_min;
      $("presets").querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("active",
          +c.dataset.focus === s.focus_min && +c.dataset.break === s.break_min));
    }
    if (Number.isFinite(s.music_vol)) $("musicVol").value = s.music_vol;
    if (Number.isFinite(s.rain_vol)) $("rainVol").value = s.rain_vol;
    Audio.musicOn = s.music_on !== false;
    Audio.rainOn = s.rain_on !== false;
    $("musicToggle").classList.toggle("off", !Audio.musicOn);
    $("rainToggle").classList.toggle("off", !Audio.rainOn);
    if (Number.isFinite(s.track)) setTrack(s.track);
    // 若音频已启动,同步音量
    if (Audio.ctx) {
      setMusicVol(Audio.musicOn ? $("musicVol").value / 100 : 0);
      setRainVol(Audio.rainOn ? $("rainVol").value / 100 : 0);
      if (window.Scene3D) Scene3D.setRain(Audio.rainOn);
    }
  }
  setMode("focus");
  renderTimer();
  scheduleCloudPush();   // 把合并后的计数同步回云端
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
  // 番茄钟运行状态:切后台/重载后按结束时间戳续上,不重新计时
  if (st.mode === "focus" || st.mode === "break") setMode(st.mode);
  if (st.running && Number.isFinite(st.endAt) && st.endAt > 0) {
    const left = Math.round((st.endAt - Date.now()) / 1000);
    if (left > 0) {
      timer.endAt = st.endAt; timer.remain = left; timer.running = true;
      startTick();
    } else {
      // 在后台跑完了这个阶段:专注补计一个番茄,切到下一阶段并暂停
      if (st.mode === "focus") timer.count++;
      timer.running = false; timer.endAt = 0;
      setMode(st.mode === "focus" ? "break" : "focus");
    }
  } else if (Number.isFinite(st.remain) && st.remain > 0) {
    timer.remain = st.remain;   // 暂停态也保留剩余时间
  }
  // 音量滑块位置
  if (Number.isFinite(st.musicVol)) $("musicVol").value = st.musicVol;
  if (Number.isFinite(st.rainVol)) $("rainVol").value = st.rainVol;
  // 开关(此时音频还没启动,先记状态,enter() 里应用)
  if (st.musicOn === false) { Audio.musicOn = false; $("musicToggle").classList.add("off"); }
  if (st.rainOn === false) { Audio.rainOn = false; $("rainToggle").classList.add("off"); }
  // 曲目选择(音频未启动,setTrack 会直接设为当前并刷新标签)
  if (Number.isFinite(st.track)) setTrack(st.track);
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
  endAt: 0,               // 运行时:本阶段结束的绝对时间戳(ms)。按它算剩余,切后台/重载也准
  count: 0,
  iv: null,
};
function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}
// 运行时按结束时间戳算剩余秒数;暂停时返回冻结值
function remainNow() {
  return timer.running ? Math.max(0, Math.round((timer.endAt - Date.now()) / 1000)) : timer.remain;
}
function startTick() {
  clearInterval(timer.iv);
  timer.iv = setInterval(() => {
    timer.remain = remainNow();
    if (timer.remain <= 0) finishPhase();
    else renderTimer();
  }, 250);   // 250ms:更跟手,且切回前台能很快校正
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
    timer.endAt = Date.now() + timer.remain * 1000;   // 锚定结束时刻
    startTick();
  } else {
    timer.remain = remainNow();                        // 冻结剩余
    timer.endAt = 0;
    clearInterval(timer.iv);
  }
  renderTimer();
  saveState();
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
  // 自动进入下一阶段(继续按时间戳运行)
  timer.running = true;
  timer.endAt = Date.now() + timer.remain * 1000;
  startTick();
  renderTimer();
  saveState();
}
function resetTimer() {
  clearInterval(timer.iv);
  timer.running = false;
  timer.endAt = 0;
  setMode(timer.mode);
  saveState();
}
function skipPhase() {
  clearInterval(timer.iv);
  const wasRunning = timer.running;
  timer.running = false;
  timer.endAt = 0;
  if (timer.mode === "focus") setMode("break"); else setMode("focus");
  if (wasRunning) toggleTimer();   // 续上运行(会重设 endAt)
  else saveState();
}

/* ============================== Web Audio 引擎 ============================== */
const Audio = {
  ctx: null, master: null, musicBus: null, rainGain: null, reverb: null,
  musicOn: true, rainOn: true,
  rainSrc: null,
  // 调度(tempo/swing 等改由当前曲目 Audio.track 提供)
  step: 0, bar: 0, nextTime: 0, schedIv: null,
  noiseBuf: null,
  // 曲目:trackIdx=正在播放;pendingIdx!=null 表示已选、待小节边界切换
  trackIdx: 0, pendingIdx: null, track: null,
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* —— 可切换曲目预设:都在柔和 lo-fi 家族内(无 hi-hat / 黑胶噪点 / 刺耳军鼓) ——
   prog=和弦(MIDI),scale=旋律音池,drums.kick/snare=该鼓出现的 16 分步,
   空数组=无该鼓;revMul=旋律/pad 的混响送量倍率。 */
const TRACKS = [
  { // 0 · 雨巷:温柔雨夜爵士(= 原曲,默认)
    name: "雨巷", tempo: 72, swing: 0.18,
    prog: [[50,53,57,60],[55,59,62,65],[48,52,55,59],[45,48,52,55]], // Dm7–G7–Cmaj7–Am7
    scale: [69,72,74,76,79,81], // A 小调五声
    pad:    { type: "triangle", level: 0.05, detune: 0.06 },
    bass:   { level: 0.20, cut: 320 },
    melody: { type: "sine", level: 0.07, onProb: 0.45, offProb: 0.12, octChance: 0.25 },
    drums:  { kick: [0, 8], snare: [4, 12], kickLevel: 0.22, snareLevel: 0.05 },
    revMul: 1,
  },
  { // 1 · 暖阳午后:明亮大调、稍快、慵懒(I–vi–ii–V,加 9 音展开排列)
    name: "暖阳午后", tempo: 78, swing: 0.16,
    // Cmaj9 – Am9 – Dm9 – G9:根音低八度 + 3/7/9 散在上方,跨两个八度留白
    prog: [[48,64,67,71,74],[45,60,64,67,71],[50,65,69,72,76],[43,62,65,69,72]],
    scale: [67,69,72,74,76,79,81], // C 大调五声 + 9 音(D)
    pad:    { type: "triangle", level: 0.05, detune: 0.05 },
    bass:   { level: 0.20, cut: 360 },
    melody: { type: "triangle", level: 0.06, onProb: 0.50, offProb: 0.16, octChance: 0.20 },
    drums:  { kick: [0, 8], snare: [4, 12], kickLevel: 0.20, snareLevel: 0.045 },
    revMul: 0.9,
  },
  { // 2 · 星海:慢、梦幻、高把位铺底、重混响、极简鼓
    name: "星海", tempo: 60, swing: 0.20,
    // Amaj9 – F#m9 – Bm9 – E9:高把位散开排列,根音低八度 + 9 音点缀,空灵留白
    prog: [[45,61,64,68,71],[42,57,61,64,68],[47,62,66,69,73],[40,59,63,66,71]],
    scale: [69,73,76,78,81,85], // A 大调五声高把位(含 9 音 B)
    pad:    { type: "sine", level: 0.055, detune: 0.05 },
    bass:   { level: 0.18, cut: 260 },
    melody: { type: "sine", level: 0.06, onProb: 0.30, offProb: 0.06, octChance: 0.15 },
    drums:  { kick: [0], snare: [], kickLevel: 0.16, snareLevel: 0 },
    revMul: 1.5,
  },
  { // 3 · 雪夜:超柔、无鼓、厚 pad、温暖
    name: "雪夜", tempo: 68, swing: 0.14,
    // Fmaj9 – Em9 – Dm9 – Cmaj9:厚 pad 下行级进,9 音让和声温暖不闷
    prog: [[41,60,64,67,72],[40,59,62,66,71],[38,57,60,65,69],[36,55,59,64,67]],
    scale: [65,67,69,72,74,77], // F 调中音区五声(含 9 音 G)
    pad:    { type: "triangle", level: 0.06, detune: 0.08 },
    bass:   { level: 0.20, cut: 300 },
    melody: { type: "sine", level: 0.055, onProb: 0.35, offProb: 0.05, octChance: 0.10 },
    drums:  { kick: [], snare: [], kickLevel: 0, snareLevel: 0 },
    revMul: 1.4,
  },
];
Audio.track = TRACKS[0];

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
function kick(t, level) {
  const ctx = Audio.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(125, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.13);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level != null ? level : 0.22, t + 0.01);
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

/* —— 旋律/pad 的混响送量(随曲目 revMul 缩放) —— */
function revSend(node, mul) {
  if (!Audio._revIn) return;
  if (mul == null || mul === 1) { node.connect(Audio._revIn); return; }
  const sg = Audio.ctx.createGain();
  sg.gain.value = mul;
  node.connect(sg); sg.connect(Audio._revIn);
}

/* —— 调度器(lookahead) —— */
function scheduler() {
  if (!Audio.musicOn) { // 仍推进时间,避免恢复时跳变
    Audio.nextTime = Audio.ctx.currentTime + 0.12;
    return;
  }
  const sec16 = 60 / Audio.track.tempo / 4;
  while (Audio.nextTime < Audio.ctx.currentTime + 0.2) {
    const swing = (Audio.step % 2 === 1) ? sec16 * Audio.track.swing : 0;
    scheduleStep(Audio.step, Audio.nextTime + swing, sec16);
    Audio.nextTime += sec16;
    Audio.step = (Audio.step + 1) % 16;
    if (Audio.step === 0) Audio.bar++;
  }
}
function scheduleStep(step, t, sec16) {
  // 小节起点:若有待切曲目,在此整小节边界换,避免半小节和弦打架
  if (step === 0 && Audio.pendingIdx != null && Audio.pendingIdx !== Audio.trackIdx) {
    Audio.trackIdx = Audio.pendingIdx;
    Audio.track = TRACKS[Audio.trackIdx];
    Audio.pendingIdx = null;
  }
  const tk = Audio.track;
  const chord = tk.prog[Audio.bar % tk.prog.length];

  // 每小节起:铺底和弦 pad
  if (step === 0) {
    const barLen = sec16 * 16;
    const d = tk.pad.detune;
    chord.forEach((m) => {
      [-d, d].forEach((det) => {
        const g = tone(mtof(m) * (1 + det / 12), t, barLen * 0.95,
          tk.pad.type, tk.pad.level, Audio.musicBus, 0.7, 0.5);
        revSend(g, tk.revMul); // pad 送一点混响
      });
    });
    // 低音根音
    bassNote(chord[0] - 12, t, barLen * 0.48, tk.bass.level, tk.bass.cut);
  }
  // 小节中点再补一下低音
  if (step === 8) bassNote(chord[0] - 12, t, sec16 * 8 * 0.46, tk.bass.level, tk.bass.cut);

  // 鼓:由曲目定义(空数组=无该鼓);保持柔和,不引入明亮/噪声打击乐
  if (tk.drums.kick.indexOf(step) !== -1) kick(t, tk.drums.kickLevel);
  // 军鼓(柔:调暗调轻,从"嚓"变成闷一点的"哒")
  if (tk.drums.snare.indexOf(step) !== -1) noiseHit(t, 0.14, tk.drums.snareLevel, 700, 2600);

  // 旋律:稀疏,落在拍点上
  const mel = tk.melody;
  const onBeat = step % 4 === 0;
  if ((onBeat && Math.random() < mel.onProb) || (!onBeat && Math.random() < mel.offProb)) {
    const note = tk.scale[Math.floor(Math.random() * tk.scale.length)] +
      (Math.random() < mel.octChance ? 12 : 0);
    const g = tone(mtof(note), t, sec16 * (Math.random() < 0.4 ? 4 : 2),
      mel.type, mel.level, Audio.musicBus, 0.02, 0.5);
    revSend(g, tk.revMul);
  }
}
function bassNote(m, t, dur, level, cut) {
  const ctx = Audio.ctx;
  const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cut != null ? cut : 320;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level != null ? level : 0.2, t + 0.03);
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

/* —— 曲目切换 —— */
// 当前“已选”曲目(pending 优先):用于 UI 与存盘,即使真正切换发生在下一小节
function selectedTrackIdx() {
  return Audio.pendingIdx != null ? Audio.pendingIdx : Audio.trackIdx;
}
function updateTrackLabel() {
  const name = TRACKS[selectedTrackIdx()].name;
  const btn = $("trackBtn");
  if (btn) btn.textContent = "♫ " + name;
  const np = document.querySelector(".nowplaying");
  if (np) np.textContent = "♪ " + name + " · 实时生成 · 无限循环";
}
// 选定曲目:音乐已在播则下一小节边界平滑切;未启动则直接设为当前
function setTrack(i) {
  i = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
  if (Audio.ctx) {
    Audio.pendingIdx = i;            // 在 scheduleStep 的 step===0 处真正切换
  } else {
    Audio.trackIdx = i; Audio.track = TRACKS[i]; Audio.pendingIdx = null;
  }
  updateTrackLabel();
  saveState();
}
function cycleTrack() { setTrack(selectedTrackIdx() + 1); }

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
  $("trackBtn").addEventListener("click", cycleTrack);
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

  // “更多”按钮(窄屏):向上弹出/收起次要按钮面板
  const dock = document.querySelector(".dock");
  const moreBtn = $("moreBtn");
  const closeMore = () => { dock.classList.remove("more-open"); moreBtn.setAttribute("aria-expanded", "false"); };
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = dock.classList.toggle("more-open");
    moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  // 点面板内按钮后自动收起;点面板外区域也收起
  $("dockRest").addEventListener("click", (e) => { if (e.target.closest(".iconbtn")) closeMore(); });
  document.addEventListener("click", (e) => {
    if (dock.classList.contains("more-open") && !e.target.closest(".dock")) closeMore();
  });

  // 空格 = 番茄钟开始/暂停(进入后才生效)
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && $("gate").classList.contains("gone")) {
      e.preventDefault(); toggleTimer();
    }
  });

  // 切回前台时按结束时间戳立即校正(后台 setInterval 会被浏览器限流)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && timer.running) {
      timer.remain = remainNow();
      if (timer.remain <= 0) finishPhase(); else renderTimer();
    }
  });
}

/* ============================== 登录 / 云端同步 UI ============================== */
function openAuth() { $("authModal").classList.remove("hidden"); }
function closeAuth() { $("authModal").classList.add("hidden"); }
function setAuthMsg(t) { $("authMsg").textContent = t || ""; }

function zhAuthErr(m) {
  m = m || "";
  if (/Invalid login/i.test(m)) return "邮箱或密码不对";
  if (/already registered|already exists|User already/i.test(m)) return "该邮箱已注册,请直接登录";
  if (/at least 6|password should/i.test(m)) return "密码至少 6 位";
  if (/valid email|invalid email/i.test(m)) return "邮箱格式不对";
  if (/Email not confirmed/i.test(m)) return "邮箱未验证(可在 Supabase 关闭邮箱验证)";
  return m;
}

function renderAuthUI(user) {
  const acct = $("acctBtn");
  if (user) {
    $("authForm").classList.add("hidden");
    $("authLogout").classList.remove("hidden");
    const st = $("authStatus");
    st.classList.remove("hidden");
    st.textContent = "已登录:" + (user.email || "账号") + " · 数据已云端同步";
    if (acct) { acct.classList.add("on"); acct.title = "已登录 · 云端同步"; }
  } else {
    $("authForm").classList.remove("hidden");
    $("authLogout").classList.add("hidden");
    $("authStatus").classList.add("hidden");
    if (acct) { acct.classList.remove("on"); acct.title = "登录 / 云端同步"; }
  }
}

function bindAuth() {
  $("acctBtn").addEventListener("click", openAuth);
  $("authClose").addEventListener("click", closeAuth);
  $("authModal").addEventListener("click", (e) => { if (e.target === $("authModal")) closeAuth(); });

  $("authLogin").addEventListener("click", async () => {
    setAuthMsg("登录中…");
    const { error } = await Cloud.signIn($("authEmail").value.trim(), $("authPass").value);
    if (error) setAuthMsg("登录失败:" + zhAuthErr(error.message));
    else { setAuthMsg(""); closeAuth(); }
  });
  $("authSignup").addEventListener("click", async () => {
    setAuthMsg("注册中…");
    const { error } = await Cloud.signUp($("authEmail").value.trim(), $("authPass").value);
    if (error) setAuthMsg("注册失败:" + zhAuthErr(error.message));
    else setAuthMsg("注册成功,正在登录…");
  });
  $("authLogout").addEventListener("click", async () => {
    await Cloud.signOut();
    closeAuth();
  });

  // 登录态变化(含初始):更新界面 + 拉取云端数据
  Cloud.onChange((user) => {
    renderAuthUI(user);
    if (user) loadFromCloud();
    renderTodos();   // 登录/退出后刷新待办
  });
}

/* ============================== 待办清单(云端,登录后可用) ============================== */
function toggleTodo() {
  const p = $("todoPanel");
  const willShow = p.classList.contains("hidden");
  p.classList.toggle("hidden");
  $("todoBtn").classList.toggle("on", willShow);
  if (willShow) renderTodos();
}

let _todos = [];   // 待办本地缓存(乐观更新的来源)
let _histText = "";  // 导出用的历史文本

// "2026-06-18" -> "6月18日";  full=true -> 加 "周四"
function fmtDayLabel(ymd, full) {
  const p = String(ymd).split("-").map(Number);
  if (p.length < 3) return ymd;
  const dt = new Date(p[0], p[1] - 1, p[2]);
  let s = p[1] + "月" + p[2] + "日";
  if (full) s += " 周" + "日一二三四五六"[dt.getDay()];
  return s;
}

// 写操作带一次重试,返回 error(null=成功)
async function todoWrite(fn) {
  let r = await fn();
  if (r && r.error) { await new Promise((res) => setTimeout(res, 600)); r = await fn(); }
  return r ? r.error : null;
}

async function renderTodos() {
  const list = $("todoList"), hint = $("todoHint");
  if (!list) return;
  const tt = $("todoTitle"); if (tt) tt.textContent = fmtDayLabel(todayKey()) + " 待办";
  if (!(window.Cloud && Cloud.user)) {
    _todos = []; list.innerHTML = "";
    hint.textContent = "登录后使用待办（点底部 ☁ 登录），任务会在手机/电脑间云端同步。";
    $("todoInput").disabled = true; $("todoAdd").disabled = true;
    return;
  }
  $("todoInput").disabled = false; $("todoAdd").disabled = false;
  hint.textContent = "加载中…";
  const res = await Cloud.listTasks(todayKey());
  if (res.error) {
    list.innerHTML = "";
    hint.textContent = "读取失败：" + (res.error.message || res.error.code || "网络/权限问题");
    return;
  }
  _todos = res.data;
  paintTodos();
}

function paintTodos() {
  const list = $("todoList"), hint = $("todoHint");
  list.innerHTML = "";
  _todos.forEach((t) => list.appendChild(taskItem(t)));
  const left = _todos.filter((t) => !t.done).length;
  hint.textContent = _todos.length
    ? ("还剩 " + left + " 项 · 共 " + _todos.length)
    : "今天还没有待办，加一项吧。";
}

function taskItem(t) {
  const li = document.createElement("li");
  li.className = "todo-item" + (t.done ? " done" : "");
  const cb = document.createElement("span");
  cb.className = "todo-check"; cb.textContent = t.done ? "✓" : "";
  const txt = document.createElement("span");
  txt.className = "todo-text"; txt.textContent = t.title;
  const del = document.createElement("button");
  del.className = "todo-del"; del.textContent = "×"; del.title = "删除";
  // 点勾选框或文字都能切换完成(大点击区,手机好按);点 × 删除
  const toggle = (e) => { e.stopPropagation(); toggleTask(t); };
  cb.addEventListener("click", toggle);
  txt.addEventListener("click", toggle);
  del.addEventListener("click", (e) => { e.stopPropagation(); removeTask(t); });
  li.appendChild(cb); li.appendChild(txt); li.appendChild(del);
  return li;
}

async function toggleTask(t) {
  const nd = !t.done;
  t.done = nd; paintTodos();                       // 乐观:立即打勾/取消
  const err = await todoWrite(() => Cloud.setTaskDone(t.id, nd));
  if (err) { t.done = !nd; paintTodos(); $("todoHint").textContent = "保存失败(网络)，已撤销，请重试"; }
}

async function removeTask(t) {
  const i = _todos.indexOf(t);
  if (i < 0) return;
  _todos.splice(i, 1); paintTodos();               // 乐观:立即移除
  const err = await todoWrite(() => Cloud.deleteTask(t.id));
  if (err) { _todos.splice(i, 0, t); paintTodos(); $("todoHint").textContent = "删除失败(网络)，已恢复"; }
}

async function addTodo() {
  const inp = $("todoInput");
  const title = inp.value.trim();
  if (!title || !(window.Cloud && Cloud.user)) return;
  inp.value = "";
  $("todoHint").textContent = "添加中…";
  const day = todayKey();
  let res = await Cloud.addTask(title, day);
  if (res && res.error) {
    // 可能其实已写入(响应丢了) → 查重避免重复
    const cur = await Cloud.listTasks(day);
    if (!cur.error && cur.data.some((t) => t.title === title)) { _todos = cur.data; paintTodos(); return; }
    await new Promise((r) => setTimeout(r, 700));
    res = await Cloud.addTask(title, day);
  }
  if (res && res.error) {
    $("todoHint").textContent = "添加失败：网络不稳(iCloud 私密代理/校园网?)，内容已保留，换网或稍后再点 +";
    inp.value = title;
    return;
  }
  if (res && res.data) { _todos.push(res.data); paintTodos(); }   // 乐观追加
  else renderTodos();
}

/* —— 历史记录 / 导出 —— */
async function openHistory() {
  if (!(window.Cloud && Cloud.user)) return;
  const body = $("histBody");
  $("histModal").classList.remove("hidden");
  body.textContent = "加载中…";
  const res = await Cloud.listAllTasks();
  if (res.error) { body.textContent = "读取失败：" + (res.error.message || "网络/权限问题"); _histText = ""; return; }
  if (!res.data.length) { body.textContent = "还没有记录，先去加几条待办吧。"; _histText = ""; return; }
  // 按日期分组(已按 day 倒序、created_at 升序)
  const byDay = {};
  res.data.forEach((t) => { (byDay[t.day] = byDay[t.day] || []).push(t); });
  const days = Object.keys(byDay).sort().reverse();
  body.innerHTML = "";
  let txt = "夜间自习室 · 待办记录\n导出时间：" + todayKey() + "\n\n";
  days.forEach((d) => {
    const items = byDay[d];
    const doneN = items.filter((t) => t.done).length;
    const dh = document.createElement("div");
    dh.className = "hist-day";
    dh.textContent = fmtDayLabel(d, true) + "  (" + doneN + "/" + items.length + ")";
    body.appendChild(dh);
    txt += "# " + d + " " + fmtDayLabel(d, true) + "  (" + doneN + "/" + items.length + ")\n";
    items.forEach((t) => {
      const it = document.createElement("div");
      it.className = "hist-item" + (t.done ? " done" : "");
      it.textContent = (t.done ? "✓ " : "○ ") + t.title;   // textContent 防注入
      body.appendChild(it);
      txt += (t.done ? "[x] " : "[ ] ") + t.title + "\n";
    });
    txt += "\n";
  });
  _histText = txt;
}
function exportHistory() {
  if (!_histText) return;
  const blob = new Blob([_histText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "待办记录_" + todayKey() + ".txt";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function copyHistory() {
  if (!_histText || !navigator.clipboard) return;
  navigator.clipboard.writeText(_histText).then(
    () => { $("histCopy").textContent = "已复制"; setTimeout(() => ($("histCopy").textContent = "复制"), 1500); },
    () => { $("histCopy").textContent = "复制失败"; }
  );
}

function bindTodo() {
  $("todoBtn").addEventListener("click", toggleTodo);
  $("todoClose").addEventListener("click", () => {
    $("todoPanel").classList.add("hidden");
    $("todoBtn").classList.remove("on");
  });
  $("todoAdd").addEventListener("click", addTodo);
  $("todoInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addTodo(); });
  // 历史记录弹窗
  $("todoHist").addEventListener("click", openHistory);
  $("histClose").addEventListener("click", () => $("histModal").classList.add("hidden"));
  $("histModal").addEventListener("click", (e) => { if (e.target === $("histModal")) $("histModal").classList.add("hidden"); });
  $("histExport").addEventListener("click", exportHistory);
  $("histCopy").addEventListener("click", copyHistory);
}

function main() {
  if (window.Scene3D) Scene3D.init();
  bindUI();
  bindTodo();
  applySavedState();   // 先用本地数据即时渲染(快)
  renderTimer();
  tickClock();
  setInterval(tickClock, 1000 * 20);
  rotateQuote();
  setInterval(rotateQuote, 1000 * 30);
  // 云端同步:初始化 Supabase;已登录则 onChange 自动拉取覆盖
  if (window.Cloud && Cloud.init()) {
    bindAuth();
  } else {
    const acct = $("acctBtn");
    if (acct) acct.style.display = "none";   // 库未加载,隐藏登录入口
  }
}
document.addEventListener("DOMContentLoaded", main);
