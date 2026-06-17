"use strict";

/* =========================================================================
   夜间自习室 · editor.js —— 可视化编辑模式
   仅当 URL 带 ?edit 时激活;否则整个文件什么都不做(对正常访客零负担)。

   - OrbitControls:鼠标拖拽转视角 + 滚轮缩放(正交相机走 camera.zoom)
   - TransformControls:下拉选中台灯/床/人物/月亮/地毯后,直接用鼠标拖动
   - 数据驱动滑块面板(SCHEMA):实时调参,改完即时 apply() 或 debounce rebuild()
   - 一键导出:生成可直接粘回 scene3d.js 的 PARAMS 代码 + 复制
   - localStorage 暂存:刷新不丢;可一键重置

   依赖加载顺序:three → OrbitControls/TransformControls → scene3d → app → editor
   ========================================================================= */

(function () {
  // —— 仅 ?edit 激活 ——
  if (!/[?&]edit(\b|=)/.test(location.search)) return;

  // —— 手机/触屏:可视化编辑器依赖鼠标拖拽,不适用;给提示后退出 ——
  const smallTouch = window.matchMedia("(max-width:760px)").matches ||
    (("ontouchstart" in window) && !window.matchMedia("(pointer:fine)").matches);
  if (smallTouch) {
    const tip = document.createElement("div");
    tip.textContent = "🖥 可视化编辑器请在电脑上打开（?edit）";
    tip.style.cssText = "position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));" +
      "transform:translateX(-50%);z-index:30;max-width:88vw;text-align:center;padding:10px 16px;" +
      "border-radius:999px;background:rgba(28,16,34,.85);color:#fff3e2;font:13px/1.4 sans-serif;" +
      "-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,210,160,.2);";
    if (document.body) document.body.appendChild(tip);
    else document.addEventListener("DOMContentLoaded", () => document.body.appendChild(tip));
    return;
  }

  // 与 scene3d.js 对应的换算基准(拖物体写回 PARAMS 时用)
  const LAMP_BASE_Y = 2.12, MOON_BASE_R = 1.4, RUG_BASE_W = 4.6, RUG_BASE_D = 3.4;
  const LS_KEY = "lofi-editor";

  /* —— 面板结构:数值字段 [key,label,min,max,step];颜色 [key,label,'color'] —— */
  const SCHEMA = [
    { group: "camera", label: "相机", mode: "apply", note: "位置/角度用鼠标拖,滚轮缩放", fields: [
      ["frustum", "视野", 3, 12, 0.1], ["zoom", "缩放", 0.3, 3, 0.01],
    ]},
    { group: "lighting", label: "灯光 / 氛围", mode: "apply", fields: [
      ["hemiInt", "半球光", 0, 2, 0.01], ["ambInt", "环境光", 0, 2, 0.01],
      ["moonInt", "月光强度", 0, 3, 0.01], ["moonColor", "月光色", "color"],
      ["moonX", "月光X", -20, 20, 0.1], ["moonY", "月光Y", 0, 20, 0.1], ["moonZ", "月光Z", -25, 5, 0.1],
      ["screenInt", "屏幕光", 0, 2, 0.01], ["exposure", "曝光", 0.3, 2, 0.01],
      ["fogColor", "雾色", "color"], ["fogDensity", "雾浓度", 0, 0.08, 0.001],
    ]},
    { group: "lamp", label: "台灯", mode: "apply", fields: [
      ["x", "位置X", -5, 5, 0.02], ["y", "位置Y", -2, 2, 0.02], ["z", "位置Z", -6, 2, 0.02],
      ["scale", "大小", 0.3, 3, 0.01],
      ["lightInt", "灯光强度", 0, 6, 0.05], ["lightColor", "灯光色", "color"],
      ["bulbEmi", "灯泡亮度", 0, 5, 0.05], ["shadeColor", "灯罩色", "color"],
    ]},
    { group: "city", label: "背景楼(重建)", mode: "rebuild", fields: [
      ["count", "数量", 0, 80, 1],
      ["rInner", "内半径", 5, 25, 0.5], ["rOuter", "外半径", 8, 35, 0.5],
      ["hMin", "最矮", 1, 10, 0.1], ["hMax", "最高", 2, 18, 0.1],
      ["wMin", "最窄", 0.5, 4, 0.1], ["wMax", "最宽", 0.8, 5, 0.1],
      ["winChance", "亮窗概率", 0, 1, 0.01],
    ]},
    { group: "bed", label: "床", mode: "apply", fields: [
      ["x", "位置X", -6, 2, 0.05], ["z", "位置Z", -4, 4, 0.05], ["scale", "大小", 0.4, 2.5, 0.01],
      ["frameColor", "床架色", "color"], ["mattressColor", "床垫色", "color"],
    ]},
    { group: "quilt", label: "被子(重建)", mode: "rebuild", fields: [
      ["color", "颜色", "color"], ["puff", "蓬松度", 0.3, 2.5, 0.02],
      ["drape", "垂边", 0, 3, 0.02], ["segments", "褶皱段数", 1, 8, 1], ["skew", "起伏", 0, 1, 0.01],
    ]},
    { group: "person", label: "人物", mode: "apply", fields: [
      ["x", "位置X", -5, 3, 0.05], ["z", "位置Z", -5, 3, 0.05], ["scale", "大小", 0.4, 2.5, 0.01],
      ["bodyColor", "身体色", "color"], ["hairColor", "头发色", "color"],
    ]},
    { group: "rug", label: "地毯", mode: "apply", fields: [
      ["x", "位置X", -5, 3, 0.05], ["z", "位置Z", -5, 3, 0.05],
      ["w", "宽", 1, 8, 0.1], ["d", "深", 1, 8, 0.1], ["color", "颜色", "color"],
    ]},
    { group: "moon", label: "月亮", mode: "apply", fields: [
      ["x", "位置X", -25, 25, 0.2], ["y", "位置Y", 0, 25, 0.2], ["z", "位置Z", -40, -5, 0.2],
      ["size", "大小", 0.3, 5, 0.05], ["emi", "亮度", 0, 4, 0.05],
    ]},
  ];

  /* —— 可被 TransformControls 拖动的物体:ref 名 + 拖完写回 PARAMS —— */
  const DRAGGABLE = {
    lamp:   { ref: "lampGroup",   group: "lamp",   read: (o, P) => { P.lamp.x = r3(o.position.x); P.lamp.z = r3(o.position.z); P.lamp.y = r3(o.position.y - LAMP_BASE_Y); P.lamp.scale = r3(o.scale.x); } },
    bed:    { ref: "bedGroup",    group: "bed",    read: (o, P) => { P.bed.x = r3(o.position.x); P.bed.z = r3(o.position.z); P.bed.scale = r3(o.scale.x); } },
    person: { ref: "personGroup", group: "person", read: (o, P) => { P.person.x = r3(o.position.x); P.person.z = r3(o.position.z); P.person.scale = r3(o.scale.x); } },
    moon:   { ref: "moonMesh",    group: "moon",   read: (o, P) => { P.moon.x = r3(o.position.x); P.moon.y = r3(o.position.y); P.moon.z = r3(o.position.z); P.moon.size = r3(o.scale.x * MOON_BASE_R); } },
    rug:    { ref: "rugMesh",     group: "rug",    read: (o, P) => { P.rug.x = r3(o.position.x); P.rug.z = r3(o.position.z); P.rug.w = r3(o.scale.x * RUG_BASE_W); P.rug.d = r3(o.scale.z * RUG_BASE_D); } },
  };
  const DRAG_LABELS = { lamp: "台灯", bed: "床", person: "人物", moon: "月亮", rug: "地毯" };

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const isColor = (k) => /color/i.test(k);
  const ctrls = {}; // `${group}.${key}` -> {el, valEl, type}
  let orbit, tc, saveTimer, rebuildTimer;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(init);

  function init() {
    if (!window.THREE || !window.Scene3D) { console.warn("[editor] THREE / Scene3D 缺失"); return; }
    if (!THREE.OrbitControls || !THREE.TransformControls) { console.warn("[editor] 控制器脚本未加载"); return; }
    const three = Scene3D.three();
    if (!three || !three.camera) { console.warn("[editor] 场景尚未初始化"); return; }

    // 编辑模式跳过进入遮罩(z20 的 gate 会挡住编辑面板);音频保持未启动,专注调视觉
    const gate = document.getElementById("gate");
    if (gate) gate.classList.add("gone");

    setupControls(three);
    buildPanel();

    if (loadLS()) { applyAll(); syncAll(); }
  }

  /* ============================== 控制器 ============================== */
  function setupControls(three) {
    const { camera, renderer, scene } = three;
    const P = Scene3D.params;

    Scene3D.setDrift(false); // 关掉自动镜头微动,交给 OrbitControls

    orbit = new THREE.OrbitControls(camera, renderer.domElement);
    orbit.target.set(P.camera.targetX, P.camera.targetY, P.camera.targetZ);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.update();
    // 把 orbit.update 注入 scene3d 既有的渲染循环(damping 需要每帧)
    Scene3D.addFrameCallback(() => orbit.update());

    // 拖拽/缩放后,把当前视角写回 PARAMS,导出即所见
    orbit.addEventListener("change", () => {
      const c = P.camera;
      c.posX = r3(camera.position.x); c.posY = r3(camera.position.y); c.posZ = r3(camera.position.z);
      c.targetX = r3(orbit.target.x); c.targetY = r3(orbit.target.y); c.targetZ = r3(orbit.target.z);
      c.zoom = r3(camera.zoom);
      setFieldValue("camera", "zoom", c.zoom);
      scheduleSave();
    });

    tc = new THREE.TransformControls(camera, renderer.domElement);
    scene.add(tc);
    // 拖物体时禁用轨道控制,避免视角乱转
    tc.addEventListener("dragging-changed", (e) => { orbit.enabled = !e.value; });
    tc.addEventListener("objectChange", () => {
      const d = DRAGGABLE[tc.userData.key];
      if (!d) return;
      const obj = Scene3D.refs()[d.ref];
      if (!obj) return;
      d.read(obj, Scene3D.params);
      Scene3D.apply(d.group);   // 同步派生属性(灯光/月晕)并保持 PARAMS↔场景一致
      syncGroup(d.group);
      scheduleSave();
    });
  }

  function attachTarget(key) {
    if (!tc) return;
    const d = DRAGGABLE[key];
    if (!d) { tc.detach(); tc.userData.key = null; return; }
    const obj = Scene3D.refs()[d.ref];
    if (obj) { tc.attach(obj); tc.userData.key = key; }
  }

  /* ============================== 面板 UI ============================== */
  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = "editor";
    panel.className = "ed-panel";

    // 标题栏(可折叠)
    const head = document.createElement("div");
    head.className = "ed-head";
    head.innerHTML = '<span>🎛 场景编辑器</span><button class="ed-fold" title="折叠/展开">–</button>';
    panel.appendChild(head);

    const bodyWrap = document.createElement("div");
    bodyWrap.className = "ed-body";
    panel.appendChild(bodyWrap);

    head.querySelector(".ed-fold").addEventListener("click", () => {
      const hidden = bodyWrap.style.display === "none";
      bodyWrap.style.display = hidden ? "" : "none";
      head.querySelector(".ed-fold").textContent = hidden ? "–" : "+";
    });

    // —— 拖物体工具条 ——
    const tool = document.createElement("div");
    tool.className = "ed-sec ed-tool";
    tool.innerHTML = '<div class="ed-sec-title">拖动物体</div>';
    const sel = document.createElement("select");
    sel.className = "ed-select";
    sel.innerHTML = '<option value="">（不选 · 关闭拖动）</option>' +
      Object.keys(DRAGGABLE).map((k) => `<option value="${k}">${DRAG_LABELS[k]}</option>`).join("");
    sel.addEventListener("change", () => attachTarget(sel.value));
    tool.appendChild(sel);
    const modeRow = document.createElement("div");
    modeRow.className = "ed-mode";
    modeRow.innerHTML =
      '<button class="ed-btn" data-mode="translate">移动</button>' +
      '<button class="ed-btn" data-mode="scale">缩放</button>';
    modeRow.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => { if (tc) tc.setMode(b.dataset.mode); }));
    tool.appendChild(modeRow);
    bodyWrap.appendChild(tool);

    // —— 各参数分组 ——
    SCHEMA.forEach((sec) => bodyWrap.appendChild(buildSection(sec)));

    // —— 导出 / 重置 ——
    bodyWrap.appendChild(buildExport());

    document.body.appendChild(panel);
  }

  function buildSection(sec) {
    const P = Scene3D.params[sec.group];
    const wrap = document.createElement("div");
    wrap.className = "ed-sec";
    const title = document.createElement("div");
    title.className = "ed-sec-title";
    title.textContent = sec.label + (sec.note ? "" : "");
    wrap.appendChild(title);
    if (sec.note) {
      const n = document.createElement("div"); n.className = "ed-note"; n.textContent = sec.note; wrap.appendChild(n);
    }

    sec.fields.forEach((f) => {
      const key = f[0], label = f[1];
      const row = document.createElement("div");
      row.className = "ed-row";
      const lab = document.createElement("label"); lab.textContent = label; row.appendChild(lab);

      if (f[2] === "color") {
        const inp = document.createElement("input");
        inp.type = "color"; inp.className = "ed-color";
        inp.value = hexStr(P[key]);
        inp.addEventListener("input", () => {
          Scene3D.params[sec.group][key] = parseInt(inp.value.slice(1), 16);
          commit(sec);
        });
        row.appendChild(inp);
        ctrls[sec.group + "." + key] = { el: inp, valEl: null, type: "color" };
      } else {
        const min = f[2], max = f[3], step = f[4];
        const inp = document.createElement("input");
        inp.type = "range"; inp.className = "slider ed-slider";
        inp.min = min; inp.max = max; inp.step = step; inp.value = P[key];
        const val = document.createElement("span");
        val.className = "ed-val"; val.textContent = fmt(P[key], step);
        inp.addEventListener("input", () => {
          const v = parseFloat(inp.value);
          Scene3D.params[sec.group][key] = v;
          val.textContent = fmt(v, step);
          commit(sec);
        });
        row.appendChild(inp); row.appendChild(val);
        ctrls[sec.group + "." + key] = { el: inp, valEl: val, type: "range", step: step };
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  function buildExport() {
    const wrap = document.createElement("div");
    wrap.className = "ed-sec ed-export";
    wrap.innerHTML = '<div class="ed-sec-title">导出参数</div>' +
      '<div class="ed-note">点「生成」得到可直接粘回 scene3d.js 的 PARAMS,发给 AI 即可固化。</div>';
    const btnRow = document.createElement("div");
    btnRow.className = "ed-mode";
    const genBtn = document.createElement("button"); genBtn.className = "ed-btn primary"; genBtn.textContent = "生成 + 复制";
    const resetBtn = document.createElement("button"); resetBtn.className = "ed-btn"; resetBtn.textContent = "重置";
    btnRow.appendChild(genBtn); btnRow.appendChild(resetBtn);
    wrap.appendChild(btnRow);
    const ta = document.createElement("textarea");
    ta.className = "ed-out"; ta.readOnly = true; ta.spellcheck = false;
    wrap.appendChild(ta);
    const hint = document.createElement("div"); hint.className = "ed-note ed-hint"; wrap.appendChild(hint);

    genBtn.addEventListener("click", () => {
      const code = toJS(Scene3D.params);
      ta.value = code;
      copyText(code).then((ok) => { hint.textContent = ok ? "已复制到剪贴板 ✓" : "已生成(请手动复制)"; });
    });
    resetBtn.addEventListener("click", () => {
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      location.reload();
    });
    return wrap;
  }

  /* ============================== 提交改动 ============================== */
  function commit(sec) {
    if (sec.mode === "rebuild") {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => Scene3D.rebuild(sec.group), 140); // 防拖动时狂重建
    } else {
      Scene3D.apply(sec.group);
    }
    scheduleSave();
  }

  /* ============================== 面板 ↔ 参数 同步 ============================== */
  function setFieldValue(group, key, v) {
    const c = ctrls[group + "." + key];
    if (!c) return;
    if (c.type === "color") c.el.value = hexStr(v);
    else { c.el.value = v; if (c.valEl) c.valEl.textContent = fmt(v, c.step); }
  }
  function syncGroup(group) {
    const P = Scene3D.params[group];
    for (const key in P) setFieldValue(group, key, P[key]);
  }
  function syncAll() { SCHEMA.forEach((s) => syncGroup(s.group)); }

  function applyAll() {
    SCHEMA.forEach((s) => { if (s.mode === "rebuild") Scene3D.rebuild(s.group); else Scene3D.apply(s.group); });
  }

  /* ============================== localStorage ============================== */
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveLS, 200); }
  function saveLS() { try { localStorage.setItem(LS_KEY, JSON.stringify(Scene3D.params)); } catch (e) {} }
  function loadLS() {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (!s) return false;
      deepMerge(Scene3D.params, JSON.parse(s));
      return true;
    } catch (e) { return false; }
  }
  function deepMerge(dst, src) {
    for (const k in src) {
      if (src[k] && typeof src[k] === "object" && dst[k] && typeof dst[k] === "object") deepMerge(dst[k], src[k]);
      else if (k in dst) dst[k] = src[k];
    }
  }

  /* ============================== 工具 ============================== */
  function fmt(v, step) {
    if (step >= 1) return String(Math.round(v));
    const d = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    return Number(v).toFixed(d);
  }
  function hexStr(n) { return "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6); }

  // 生成可直接粘回 scene3d.js 的 PARAMS 字面量(颜色用 0xRRGGBB)
  function toJS(P) {
    let s = "const PARAMS = {\n";
    for (const g in P) {
      const parts = [];
      for (const k in P[g]) {
        let v = P[g][k];
        if (isColor(k)) v = "0x" + (v >>> 0).toString(16).padStart(6, "0").slice(-6);
        else if (typeof v === "number") v = +(+v).toFixed(4);
        else v = JSON.stringify(v);
        parts.push(k + ": " + v);
      }
      s += "  " + g + ": { " + parts.join(", ") + " },\n";
    }
    return s + "};\n";
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
})();
