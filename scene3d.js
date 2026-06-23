"use strict";

/* =========================================================================
   夜间自习室 · scene3d.js
   Three.js 等距 3D 自习室(冷暖对比)
   - OrthographicCamera 正交等距视角(固定,不跟鼠标;仅极缓慢自动微动)
   - L 形切角房间 + 后墙开窗,窗外夜空 / 月亮 / 城市 / 雨
   - 冷暖对比布光:冷色月光+环境光 / 暖色台灯点光源;PCF 软阴影
   - 家具摆件:书桌 椅子 台灯 笔电 书堆 马克杯 盆栽 地毯 戴耳机的人 小床
   - 氛围:窗外雨(随雨声开关显隐)、灯光微尘、马克杯蒸汽

   所有视觉参数集中在 PARAMS(editor.js 通过 Scene3D.params 读写,改完调
   apply()/rebuild()),并保存对象引用到 refs。不调用 apply 时,build 使用
   PARAMS 的默认值 —— 即原先写死的数值,所以非编辑模式渲染结果与之前一致。

   挂到 window.Scene3D = { init, setRain, params, apply, rebuild,
                           refs, three, setDrift, addFrameCallback }
   ========================================================================= */

window.Scene3D = (function () {
  const T = window.THREE;
  const R = (a, b) => a + Math.random() * (b - a);

  /* —— 可调参数(editor 实时改这里 + 调 apply/rebuild;也是导出的对象) —— */
  const PARAMS = {
    camera: { posX: 14.193, posY: 9.103, posZ: 9.852, targetX: 0.6, targetY: 2.3, targetZ: -0.2, frustum: 11.3, zoom: 1.2, drift: true },
    lighting: {
      hemiInt: 0.92, ambInt: 0.43,
      moonInt: 1.92, moonColor: 0x9fc0ff, moonX: 2.2, moonY: 10.8, moonZ: -12.9,
      screenInt: 2, exposure: 0.78,
      fogColor: 0x16223f, fogDensity: 0.021,
    },
    lamp: { x: -1.92, y: 0.02, z: -4.16, scale: 1.11, lightInt: 5.85, lightColor: 0xffb070, bulbEmi: 3.1, shadeColor: 0xff9d57 },
    city: { count: 80, rInner: 18, rOuter: 35, hMin: 2.5, hMax: 12.7, wMin: 1.4, wMax: 2.7, winChance: 1 },
    bed: { x: -3.4, z: 1.95, scale: 1.12, frameColor: 0x39303f, mattressColor: 0x66739c },
    quilt: { color: 0xb87a64, puff: 1.34, drape: 0.62, segments: 6, skew: 0.68 },
    person: { x: 0.15, z: -1.85, scale: 0.99, skinColor: 0xf2c9a0, bodyColor: 0x46512f, hairColor: 0x000000 },
    rug: { x: 0, z: -1.5, w: 8, d: 6.3, color: 0x5a3b3a },
    moon: { x: 5, y: 11.5, z: -22, size: 1.4, emi: 1.3 },
    // 窗外地平线高度:房间在高楼,地平线/城市应远在地板之下。
    // horizonY = 天际线(城市基座/远地面/天空亮带)的世界 Y。房间地板在 y=0,墙高约 6,
    // 取 -22 ≈ 地板下约 3.7 个房间高度(可在编辑器"窗外/地平线"里实时调)。
    backdrop: { horizonY: -9 },
  };

  /* —— 不暴露给编辑器的固定调色 —— */
  const COL = {
    floor: 0x47403a,
    wallBack: 0x2b3152, wallLeft: 0x252a45, wallTrim: 0x1b2038,
    desk: 0x6b4f37, deskLeg: 0x3a2d22,
    chair: 0x33384e,
    lampArm: 0x20242f,
    laptop: 0x2a2e3c, screen: 0x8fb6ff,
    mug: 0xc06a52, plantPot: 0x8a5a44, leaf: 0x3f7a55,
    phones: 0x14181f,
    moon: 0xeaf1ff,
    rain: 0xa9c4ff, dust: 0xffe6bd, steam: 0xdfe7f5,
  };

  /* —— 台灯 group 原点设在底座中心;地毯/月亮基准尺寸用于换算 scale —— */
  const LAMP_BASE_Y = 2.14;
  const RUG_BASE_W = 4.6, RUG_BASE_D = 3.4;
  const MOON_BASE_R = 1.4;

  let renderer, scene, camera, clock;
  let rain = null, dust = null, steam = null;
  let running = false, reduce = false;
  let driftEnabled = PARAMS.camera.drift;
  const frameCallbacks = [];
  const refs = {};
  const camBase = new T.Vector3();
  const camTarget = new T.Vector3();

  /* —— 材质/几何小工具 —— */
  function mat(color, o) {
    o = o || {};
    return new T.MeshStandardMaterial({
      color: color,
      roughness: o.rough != null ? o.rough : 0.88,
      metalness: o.metal != null ? o.metal : 0.0,
      flatShading: !!o.flat,
      emissive: o.emissive != null ? o.emissive : 0x000000,
      emissiveIntensity: o.emi != null ? o.emi : 1,
    });
  }
  function box(w, h, d, color, o) {
    o = o || {};
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(color, o));
    m.castShadow = o.cast !== false;
    m.receiveShadow = o.recv !== false;
    return m;
  }
  function place(obj, x, y, z) { obj.position.set(x, y, z); return obj; }
  function disposeObj(o) {
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) [].concat(c.material).forEach((m) => m.dispose());
    });
  }

  /* ============================== 初始化 ============================== */
  function init() {
    const canvas = document.getElementById("scene3d");
    if (!T || !canvas) {
      console.warn("[Scene3D] Three.js 或 #scene3d 画布缺失,跳过 3D 场景");
      return;
    }
    reduce = window.matchMedia && matchMedia("(prefers-reduced-motion:reduce)").matches;

    renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = PARAMS.lighting.exposure;

    scene = new T.Scene();
    scene.background = new T.Color(0x05070f);
    scene.fog = new T.FogExp2(PARAMS.lighting.fogColor, PARAMS.lighting.fogDensity);

    clock = new T.Clock();
    refs.renderer = renderer; refs.scene = scene;

    setupCamera();
    setupLights();
    buildBackdrop();
    buildRoom();
    buildFurniture();
    buildLamp();
    buildBed();
    buildPerson();
    buildMoon();
    refs.cityGroup = buildCity(PARAMS.city); scene.add(refs.cityGroup);
    buildCozy();       // 温馨摆件:串灯 / 落地灯 / 书架 / 挂画
    buildAtmosphere();
    applyBackdrop();   // 城市/天空/远地面 下移到 horizonY,形成高楼俯瞰的地平线

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", () => setTimeout(onResize, 200));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { running = false; }
      else if (!running) { running = true; clock.getDelta(); animate(); }
    });

    running = true;
    animate();
  }

  function setupCamera() {
    const c = PARAMS.camera;
    camBase.set(c.posX, c.posY, c.posZ);
    camTarget.set(c.targetX, c.targetY, c.targetZ);
    camera = new T.OrthographicCamera(-c.frustum, c.frustum, c.frustum, -c.frustum, 0.1, 100);
    applyFrustum(camera, c.frustum);
    camera.zoom = c.zoom;
    camera.position.copy(camBase);
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
    refs.camera = camera;
  }

  // 正交视锥自适应:横屏(a>=1)按高度适配;竖屏(a<1,手机)按宽度适配,
  // 否则窄高屏会把房间左右裁掉。两种情况都保证房间完整显示。
  function applyFrustum(cam, f) {
    const a = window.innerWidth / window.innerHeight;
    if (a >= 1) { cam.left = -f * a; cam.right = f * a; cam.top = f; cam.bottom = -f; }
    else { cam.left = -f; cam.right = f; cam.top = f / a; cam.bottom = -f / a; }
  }

  function setupLights() {
    const L = PARAMS.lighting;
    // 夜间冷色环境光(天空冷 / 地面暗)
    refs.hemiLight = new T.HemisphereLight(0x4a5a8a, 0x0a0a14, L.hemiInt);
    scene.add(refs.hemiLight);
    refs.ambLight = new T.AmbientLight(0x223052, L.ambInt);
    scene.add(refs.ambLight);

    // 冷色月光:从窗外斜射进来 —— 主阴影
    const moon = new T.DirectionalLight(L.moonColor, L.moonInt);
    moon.position.set(L.moonX, L.moonY, L.moonZ);
    moon.target.position.set(0, 1.5, -2);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 55;
    moon.shadow.camera.left = -13;
    moon.shadow.camera.right = 13;
    moon.shadow.camera.top = 13;
    moon.shadow.camera.bottom = -13;
    moon.shadow.bias = -0.0006;
    scene.add(moon);
    scene.add(moon.target);
    refs.moonLight = moon;

    // 笔电屏幕冷光(不投影)
    const screen = new T.PointLight(COL.screen, L.screenInt, 4.5, 2);
    screen.position.set(0.1, 2.55, -3.4);
    scene.add(screen);
    refs.screenLight = screen;
  }

  /* ============================== 球形背景 + 地面 ============================== */
  function makeSkyTexture() {
    const c = document.createElement("canvas"); c.width = 4; c.height = 256;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.00, "#060912"); // 天顶
    g.addColorStop(0.40, "#0e1730");
    g.addColorStop(0.52, "#1c2c4e"); // 地平线微亮
    g.addColorStop(0.62, "#122039");
    g.addColorStop(1.00, "#070a16"); // 天底
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
    return new T.CanvasTexture(c);
  }
  function buildBackdrop() {
    // 球形渐变天空:包住整个房间
    const sky = new T.Mesh(
      new T.SphereGeometry(60, 32, 24),
      new T.MeshBasicMaterial({ map: makeSkyTexture(), side: T.BackSide, fog: false, depthWrite: false })
    );
    sky.renderOrder = -1;
    scene.add(sky);
    // 远处地面:给背景下方铺色(远处融入雾与天际)
    const ground = new T.Mesh(new T.PlaneGeometry(400, 400), mat(0x0c1226, { rough: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.3, 0);
    ground.castShadow = false; ground.receiveShadow = false;
    scene.add(ground);
    refs.sky = sky; refs.ground = ground;
  }

  // 把"地平线"(天空亮带 / 远地面 / 窗外城市)整体下移到 backdrop.horizonY,
  // 营造"房间在高楼、城市远在脚下"的观感。可由编辑器实时调用。
  function applyBackdrop() {
    const h = PARAMS.backdrop.horizonY;
    // 天空亮带在球心略下方(贴图 0.52 处),把球整体下移让亮带落到 h 附近
    if (refs.sky) refs.sky.position.y = h + 2.4;
    if (refs.ground) refs.ground.position.y = h;
    if (refs.cityGroup) refs.cityGroup.position.y = h;
  }

  /* ============================== 房间 ============================== */
  // 房间向敞开侧(相机/+x/+z)扩大、层高抬高;后墙(z=-5)与左墙(x=-5)锚定不动,
  // 故后左角的家具无需移动、不会浮空。地板 x∈[-5,8]、z∈[-5,7],墙高 7。
  function buildRoom() {
    // 地板
    const floor = new T.Mesh(new T.BoxGeometry(13, 0.3, 12), mat(COL.floor, { rough: 0.95 }));
    floor.position.set(1.5, -0.15, 1);
    floor.receiveShadow = true; floor.castShadow = false;
    scene.add(floor);

    // 地毯(可调:位置 / 尺寸 / 颜色)
    const rugMat = mat(PARAMS.rug.color, { rough: 1 });
    const rug = new T.Mesh(new T.BoxGeometry(RUG_BASE_W, 0.06, RUG_BASE_D), rugMat);
    rug.position.set(PARAMS.rug.x, 0.03, PARAMS.rug.z);
    rug.scale.set(PARAMS.rug.w / RUG_BASE_W, 1, PARAMS.rug.d / RUG_BASE_D);
    rug.receiveShadow = true; rug.castShadow = false;
    scene.add(rug);
    refs.rugMesh = rug; refs.rugMat = rugMat;

    const wBack = mat(COL.wallBack), wLeft = mat(COL.wallLeft);
    const frameMat = mat(COL.wallTrim, { rough: 0.7 });

    // 后墙(z=-5,朝 +z)—— 4 块拼出窗洞(x∈[-2.4,2.4], y∈[1.9,4.5]);墙宽 13、层高 7
    const back = new T.Group();
    const seg = (w, h, x, y) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, 0.3), wBack);
      m.position.set(x, y, -5); m.receiveShadow = true; m.castShadow = true; back.add(m);
    };
    seg(13, 1.9, 1.5, 0.95); seg(13, 2.5, 1.5, 5.75); seg(2.6, 2.6, -3.7, 3.2); seg(5.6, 2.6, 5.2, 3.2);
    const fr = (w, h, x, y) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, 0.12), frameMat);
      m.position.set(x, y, -4.82); m.castShadow = true; m.receiveShadow = true; back.add(m);
    };
    fr(5.2, 0.18, 0, 1.9); fr(5.2, 0.18, 0, 4.5); fr(0.18, 2.6, -2.4, 3.2); fr(0.18, 2.6, 2.4, 3.2);
    fr(0.12, 2.6, 0, 3.2); fr(4.8, 0.12, 0, 3.2);
    scene.add(back);

    // 左墙(x=-5,朝 +x)—— 整面实墙(不开窗);墙深 12、层高 7
    const left = new T.Mesh(new T.BoxGeometry(0.3, 7, 12), wLeft);
    left.position.set(-5, 3.5, 1); left.receiveShadow = true; left.castShadow = true;
    scene.add(left);

    // 踢脚 / 墙角暗线(增加纵深)
    const trim = mat(COL.wallTrim, { rough: 0.9 });
    const baseB = new T.Mesh(new T.BoxGeometry(13, 0.3, 0.34), trim);
    place(baseB, 1.5, 0.15, -4.83); baseB.receiveShadow = true; scene.add(baseB);
    const baseL = new T.Mesh(new T.BoxGeometry(0.34, 0.3, 12), trim);
    place(baseL, -4.83, 0.15, 1); baseL.receiveShadow = true; scene.add(baseL);
  }

  /* ============================== 家具摆件(不含台灯) ============================== */
  function buildFurniture() {
    const g = new T.Group();

    // —— 书桌(5.6 × 2.0,桌面 y=2.0)——
    const deskTop = box(5.6, 0.18, 2.0, COL.desk, { rough: 0.7 });
    place(deskTop, -0.2, 2.0, -3.35);
    g.add(deskTop);
    [[-2.6, -4.15], [2.45, -4.15], [-2.6, -2.55], [2.45, -2.55]].forEach(([x, z]) => {
      g.add(place(box(0.16, 2.0, 0.16, COL.deskLeg, { rough: 0.8 }), x, 1.0, z));
    });

    // —— 笔记本电脑(桌中)——
    const lapBase = box(1.4, 0.08, 0.95, COL.laptop, { rough: 0.5, metal: 0.3 });
    place(lapBase, 0.1, 2.12, -3.35); g.add(lapBase);
    const lapScreen = box(1.4, 0.95, 0.07, COL.laptop, { rough: 0.5, metal: 0.3 });
    lapScreen.position.set(0.1, 2.6, -3.76); lapScreen.rotation.x = -0.32; g.add(lapScreen);
    const scr = box(1.24, 0.8, 0.02, 0x0a0f1c, { emissive: COL.screen, emi: 0.9, rough: 1, cast: false });
    scr.position.set(0.1, 2.62, -3.72); scr.rotation.x = -0.32; g.add(scr);

    // —— 书堆(桌右后角)——
    const bcol = [0x7a4a5a, 0x3a5a6a, 0xb98a4a, 0x4a3a6a];
    for (let i = 0; i < 4; i++) {
      const b = box(0.9, 0.16, 0.62, bcol[i], { rough: 0.95 });
      b.position.set(2.0 + (i % 2) * 0.05, 2.17 + i * 0.16, -3.5 + (i % 2) * 0.04);
      b.rotation.y = R(-0.12, 0.12); g.add(b);
    }

    // —— 马克杯(桌右前,远离笔电)——
    const mug = new T.Mesh(new T.CylinderGeometry(0.18, 0.16, 0.34, 18), mat(COL.mug, { rough: 0.6 }));
    place(mug, 1.45, 2.26, -2.8); mug.castShadow = true; g.add(mug);
    const handle = new T.Mesh(new T.TorusGeometry(0.12, 0.035, 8, 16), mat(COL.mug, { rough: 0.6 }));
    handle.position.set(1.66, 2.26, -2.8); handle.rotation.y = Math.PI / 2; g.add(handle);

    // —— 盆栽(桌左前角)——
    const pot = new T.Mesh(new T.CylinderGeometry(0.26, 0.2, 0.4, 14), mat(COL.plantPot, { rough: 0.9 }));
    place(pot, -2.5, 2.29, -2.95); pot.castShadow = true; g.add(pot);
    for (let i = 0; i < 5; i++) {
      const leaf = new T.Mesh(new T.IcosahedronGeometry(R(0.18, 0.26), 0), mat(COL.leaf, { flat: true, rough: 1 }));
      leaf.position.set(-2.5 + R(-0.18, 0.18), 2.72 + i * 0.12, -2.95 + R(-0.16, 0.16));
      g.add(leaf);
    }

    scene.add(g);
  }

  /* —— 台灯:独立 group(可整体移动/缩放/被 TransformControls 选中);灯头处即暖光源 —— */
  function buildLamp() {
    const p = PARAMS.lamp;
    const g = new T.Group();

    g.add(place(box(0.5, 0.08, 0.5, COL.lampArm, { metal: 0.4, rough: 0.5 }), 0, 0, 0));        // 底座
    g.add(place(box(0.07, 1.0, 0.07, COL.lampArm, { metal: 0.5, rough: 0.4 }), -0.2, 0.48, 0)); // 立杆
    const arm = box(0.9, 0.07, 0.07, COL.lampArm, { metal: 0.5, rough: 0.4 });
    arm.position.set(0.15, 0.96, 0); arm.rotation.z = -0.25; g.add(arm);

    const shadeMat = mat(p.shadeColor, { rough: 0.5, emissive: 0xff8a3a, emi: 0.35 });
    const shade = new T.Mesh(new T.ConeGeometry(0.32, 0.42, 18, 1, true), shadeMat);
    shade.position.set(0.55, 0.88, 0); shade.rotation.x = Math.PI; shade.rotation.z = 0.5;
    shade.castShadow = false; g.add(shade);

    const bulbMat = mat(0xfff0c8, { emissive: 0xffcf87, emi: p.bulbEmi, rough: 1 });
    const bulb = new T.Mesh(new T.SphereGeometry(0.07, 12, 12), bulbMat);
    bulb.position.set(0.54, 0.82, 0.02); bulb.castShadow = false; g.add(bulb); // 缩小并塞进灯罩口内,只露暖光

    // 暖色台灯点光源(作为 group 子节点,随台灯移动/缩放)
    const lamp = new T.PointLight(p.lightColor, p.lightInt, 13, 2);
    lamp.position.set(0.4, 0.93, 0.05);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.camera.near = 0.2;
    lamp.shadow.camera.far = 14;
    lamp.shadow.bias = -0.0015;
    g.add(lamp);

    g.position.set(p.x, LAMP_BASE_Y + p.y, p.z);
    g.scale.setScalar(p.scale);
    scene.add(g);
    refs.lampGroup = g; refs.lampLight = lamp; refs.lampBulbMat = bulbMat; refs.lampShadeMat = shadeMat;
  }

  /* —— 小床:靠左墙、位于小人左后侧(group 整体可调;冷床单 + 暖被子) —— */
  function buildBed() {
    const p = PARAMS.bed;
    const g = new T.Group();
    const frameMat = mat(p.frameColor, { rough: 0.9 });
    const mattressMat = mat(p.mattressColor, { rough: 1 });
    const boxM = (w, h, d, material) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), material);
      m.castShadow = true; m.receiveShadow = true; return m;
    };
    // 相对 group 原点(床中心 x,z;y 为绝对高度)
    g.add(place(boxM(2.2, 0.5, 3.9, frameMat), 0, 0.5, 0));                      // 床箱
    g.add(place(boxM(2.1, 0.28, 3.7, mattressMat), 0, 0.88, 0));                 // 床垫(冷)
    g.add(place(boxM(1.8, 0.26, 0.7, mat(0xe8dfd0, { rough: 1 })), 0, 1.12, 1.55)); // 枕头(头侧)
    g.add(place(boxM(2.2, 1.2, 0.2, frameMat), 0, 1.05, 2.05));                  // 床头板(头侧)

    const quilt = buildQuilt(PARAMS.quilt);
    g.add(quilt);

    g.position.set(p.x, 0, p.z);
    g.scale.setScalar(p.scale);
    scene.add(g);
    refs.bedGroup = g; refs.quiltMesh = quilt;
    refs.bedFrameMats = [frameMat]; refs.bedMattressMat = mattressMat;
  }

  /* —— 被子:平滑曲面 + 正弦褶皱起伏 + 中间隆起 + 边缘自然下垂 + 头侧卷边(柔软布料感) —— */
  function buildQuilt(p) {
    const g = new T.Group();
    const m = mat(p.color, { rough: 1 });          // 平滑着色(去掉 flat),像柔软布料
    const zStart = -1.85, zEnd = 1.12;             // 覆盖范围:脚侧 → 近枕侧(延长以盖住裸露床垫)
    const span = zEnd - zStart;
    const width = 2.3;                              // 略宽于床垫(2.1),自然垂到床沿
    const thick = 0.24 * p.puff;
    const baseTop = 1.12;                           // 被面基准高度(床垫上方)
    const mattressHalf = 1.02;                      // 床垫半宽(超出部分向下垂)
    const foldN = 1.3 + Math.max(1, p.segments) * 0.45; // 褶皱密度由 segments 调
    const half = width / 2, halfZ = span / 2;

    const geo = new T.BoxGeometry(width, thick, span, 30, 2, 44);
    const pos = geo.attributes.position;
    const v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const topFactor = (v.y + thick / 2) / thick;          // 0=底面 1=顶面
      // 顶面多频褶皱(叠加正弦,带 skew 不对称),只作用于上半部
      const fold =
        0.55 * Math.sin(v.x * foldN + 0.4) * Math.cos(v.z * foldN * 0.7) +
        0.28 * Math.sin(v.x * foldN * 1.9 + v.z * foldN * 1.3 + 1.7) +
        0.20 * Math.cos(v.z * foldN * 1.5 - 0.6 + v.x * p.skew * 2.0);
      v.y += fold * 0.10 * p.puff * topFactor;
      // 中间隆起(被子鼓起来,收敛一些,别成大包)
      const dome = Math.max(0, 1 - (v.x / half) ** 2) * Math.max(0, 1 - (v.z / halfZ) ** 2 * 0.5);
      v.y += 0.07 * p.puff * topFactor * dome;
      // 左右垂边:超出床垫的列整体向下垂、略外扩
      const overX = Math.abs(v.x) - mattressHalf;
      if (overX > 0) {
        const t = Math.min(1, overX / (half - mattressHalf));
        v.y -= (0.26 + 0.30 * p.drape) * t * t;
        v.x += Math.sign(v.x) * 0.05 * t;
      }
      // 脚侧(local z≈-halfZ)垂边
      const overZ = -v.z - (halfZ - 0.24);
      if (overZ > 0) {
        const tz = Math.min(1, overZ / 0.24);
        v.y -= (0.22 + 0.26 * p.drape) * tz * tz;
        v.z -= 0.05 * tz;
      }
      // 头侧(local z≈+halfZ)也收边,避免留下平整方块立面
      const overZh = v.z - (halfZ - 0.22);
      if (overZh > 0) {
        const tzh = Math.min(1, overZh / 0.22);
        v.y -= (0.16 + 0.20 * p.drape) * tzh * tzh;
        v.z += 0.04 * tzh;
      }
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const quilt = new T.Mesh(geo, m);
    quilt.castShadow = true; quilt.receiveShadow = true;
    quilt.position.set(0, baseTop, zStart + halfZ);
    g.add(quilt);

    // 头侧翻折:一条平缓卷边(压扁圆柱),像掀开的被角,紧贴被面
    const roll = new T.Mesh(
      new T.CylinderGeometry(0.13 * p.puff, 0.13 * p.puff, width * 0.97, 18, 1), m
    );
    roll.rotation.z = Math.PI / 2; roll.scale.set(1, 1, 0.6);
    roll.position.set(0, baseTop + 0.05 * p.puff, zEnd - 0.1);
    roll.castShadow = true; roll.receiveShadow = true;
    g.add(roll);

    return g;
  }

  /* —— 戴耳机的人:可爱 chibi 比例,坐姿背对相机面向窗(group 整体可调) —— */
  function buildPerson() {
    const p = PARAMS.person;
    const g = new T.Group();
    const skinMats = [], hoodieMats = [], hairMats = [];
    const skin = (rough) => { const m = mat(p.skinColor, { rough: rough != null ? rough : 0.9 }); skinMats.push(m); return m; };
    const hoodie = (rough) => { const m = mat(p.bodyColor, { rough: rough != null ? rough : 0.95 }); hoodieMats.push(m); return m; };
    const hairMat = () => { const m = mat(p.hairColor, { rough: 1 }); hairMats.push(m); return m; };

    // 椅子(相对 group;x 已去掉 CX=-0.3、z 去掉 CZ=-1.85)
    g.add(place(box(1.3, 0.18, 1.2, COL.chair, { rough: 0.8 }), 0, 1.3, 0.15));
    g.add(place(box(1.3, 1.5, 0.18, COL.chair, { rough: 0.8 }), 0, 2.0, 0.67));
    [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.65], [0.55, 0.65]].forEach(([x, z]) =>
      g.add(place(box(0.12, 1.3, 0.12, COL.deskLeg, { rough: 0.8 }), x, 0.65, z)));

    // 圆润小身子(卫衣)
    const body = new T.Mesh(new T.SphereGeometry(0.58, 24, 20), hoodie(0.95));
    body.position.set(0, 1.95, 0); body.scale.set(1.06, 1.16, 1.0); body.castShadow = true; g.add(body);
    // 卫衣帽兜(垂在颈后)
    const hood = new T.Mesh(new T.SphereGeometry(0.42, 20, 16), hoodie(0.95));
    hood.position.set(0, 2.46, 0.3); hood.scale.set(1.0, 0.72, 0.6); hood.castShadow = true; g.add(hood);
    // 卫衣口袋(身前)
    const pocket = new T.Mesh(new T.BoxGeometry(0.52, 0.3, 0.1), hoodie(0.9));
    pocket.position.set(0, 1.74, -0.52); pocket.castShadow = true; g.add(pocket);

    // 头(肤色)
    const head = new T.Mesh(new T.SphereGeometry(0.46, 28, 28), skin(0.85));
    head.position.set(0, 2.86, -0.06); head.castShadow = true; g.add(head);
    // 男生中等长度头发:头顶主体 + 颈后垂发 + 前额刘海
    const hairTop = new T.Mesh(new T.SphereGeometry(0.5, 24, 24), hairMat());
    hairTop.position.set(0, 2.97, 0.02); hairTop.scale.set(1.08, 1.06, 1.06); hairTop.castShadow = true; g.add(hairTop);
    const hairBack = new T.Mesh(new T.SphereGeometry(0.34, 20, 20), hairMat());
    hairBack.position.set(0, 2.66, 0.26); hairBack.scale.set(1.12, 1.05, 0.7); hairBack.castShadow = true; g.add(hairBack);
    const fringe = new T.Mesh(new T.SphereGeometry(0.3, 20, 20), hairMat());
    fringe.position.set(0, 3.0, -0.36); fringe.scale.set(1.35, 0.6, 0.7); fringe.castShadow = true; g.add(fringe);

    // 耳机:头梁 + 两只耳罩
    const band = new T.Mesh(new T.TorusGeometry(0.53, 0.06, 10, 24, Math.PI), mat(COL.phones, { rough: 0.5 }));
    band.position.set(0, 2.9, -0.02); g.add(band);
    [-0.53, 0.53].forEach((x) => {
      const cup = new T.Mesh(new T.SphereGeometry(0.14, 18, 18), mat(COL.phones, { rough: 0.5 }));
      cup.position.set(x, 2.84, -0.04); cup.scale.set(0.82, 1, 1); g.add(cup);
    });

    // 手臂(卫衣袖子)短前臂平搭在桌面(桌面世界 y≈2.09)+ 手(肤色)写字
    const lArm = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.64, 12), hoodie(0.95));
    lArm.position.set(-0.34, 2.16, -0.62); lArm.rotation.x = Math.PI / 2; lArm.castShadow = true; g.add(lArm);
    const rArm = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.64, 12), hoodie(0.95));
    rArm.position.set(0.3, 2.16, -0.62); rArm.rotation.set(Math.PI / 2, 0.5, 0); rArm.castShadow = true; g.add(rArm);
    const lHand = new T.Mesh(new T.SphereGeometry(0.12, 14, 14), skin(0.9));
    lHand.position.set(-0.34, 2.18, -0.96); lHand.castShadow = true; g.add(lHand);
    const rHand = new T.Mesh(new T.SphereGeometry(0.12, 14, 14), skin(0.9));
    rHand.position.set(0.12, 2.18, -0.92); rHand.castShadow = true; g.add(rHand);
    // 笔(右手握,斜尖向桌面)
    const pen = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.3, 8), mat(0xf2c14e, { rough: 0.4 }));
    pen.position.set(0.08, 2.22, -1.0); pen.rotation.set(0.9, 0.2, 0.5); g.add(pen);

    g.position.set(p.x, 0, p.z);
    g.scale.setScalar(p.scale);
    scene.add(g);
    refs.personGroup = g; refs.personSkinMats = skinMats; refs.personHoodieMats = hoodieMats; refs.personHairMats = hairMats;
  }

  /* ============================== 窗外:月亮 / 城市 ============================== */
  function buildMoon() {
    const p = PARAMS.moon;
    const moonMat = mat(COL.moon, { emissive: COL.moon, emi: p.emi, rough: 1 });
    const moon = new T.Mesh(new T.SphereGeometry(MOON_BASE_R, 24, 24), moonMat);
    moon.position.set(p.x, p.y, p.z); moon.scale.setScalar(p.size / MOON_BASE_R);
    moon.castShadow = false; scene.add(moon);
    const halo = new T.Mesh(new T.SphereGeometry(MOON_BASE_R * 1.71, 20, 20),
      new T.MeshBasicMaterial({ color: 0xcdd9f2, transparent: true, opacity: 0.12 }));
    halo.position.copy(moon.position); halo.scale.copy(moon.scale); scene.add(halo);
    refs.moonMesh = moon; refs.moonMat = moonMat; refs.moonHalo = halo;
  }

  /* ============================== 温馨摆件 ============================== */
  // 串灯 / 落地灯+前景软装 / 书架 / 挂画。只加暖色物件与一处局部暖光,
  // 不动全局冷色环境光,保持「冷夜底 + 暖光」的冷暖对比。
  function buildCozy() {
    buildFairyLights();   // 窗顶暖色串灯(自发光)
    buildReadingNook();   // 扩出的前右空地:落地灯(暖光)+ 圆地毯 + 坐垫
    buildBookshelf();     // 靠左墙的小书架 + 彩色书
    buildWallArt();       // 左墙挂画
  }

  // 暖色串灯:沿窗顶/后墙挂一串自发光小灯泡,正弦下垂成弧线
  function buildFairyLights() {
    const g = new T.Group();
    const N = 16, x0 = -3.2, x1 = 3.2, z = -4.74, yTop = 4.82, sag = 0.5;
    const wireMat = mat(0x141414, { rough: 0.8 });
    const pts = [];
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      pts.push(new T.Vector3(x0 + (x1 - x0) * f, yTop - Math.sin(f * Math.PI) * sag, z));
    }
    // 细线:相邻灯泡之间连一截细圆柱
    const up = new T.Vector3(0, 1, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const cyl = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, a.distanceTo(b), 6), wireMat);
      cyl.position.copy(a).add(b).multiplyScalar(0.5);
      cyl.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      cyl.castShadow = false; cyl.receiveShadow = false; g.add(cyl);
    }
    // 暖色灯泡(自发光,垂在线下),记录材质供动画轻微闪烁
    refs.fairy = [];
    const baseEmi = 1.8;
    pts.forEach((p, i) => {
      const m = mat(0xffe2ad, { emissive: 0xffd9a0, emi: baseEmi, rough: 1 });
      const bulb = new T.Mesh(new T.SphereGeometry(0.055, 10, 10), m);
      bulb.position.set(p.x, p.y - 0.07, p.z + 0.02);
      bulb.castShadow = false; bulb.receiveShadow = false; g.add(bulb);
      refs.fairy.push({ mat: m, base: baseEmi, phase: i * 0.7 });
    });
    scene.add(g);
    refs.fairyGroup = g;
  }

  // 阅读角(前右扩出空地):暖色圆地毯 + 坐垫 + 落地灯(第二处局部暖光)
  function buildReadingNook() {
    const cx = 4.8, cz = 3.2;
    const rug = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, 0.05, 32), mat(0x7a4a3c, { rough: 1 }));
    rug.position.set(cx, 0.025, cz); rug.receiveShadow = true; rug.castShadow = false; scene.add(rug);

    const cushion = new T.Mesh(new T.CylinderGeometry(0.5, 0.56, 0.28, 20), mat(0xb5743f, { rough: 1 }));
    cushion.position.set(cx - 0.2, 0.2, cz + 0.3); cushion.castShadow = true; cushion.receiveShadow = true; scene.add(cushion);
    const button = new T.Mesh(new T.SphereGeometry(0.05, 8, 8), mat(0x8a5630, { rough: 1 }));
    button.position.set(cx - 0.2, 0.34, cz + 0.3); scene.add(button);

    // 落地灯:底座 + 立杆 + 暖灯罩 + 灯泡 + 暖色点光(局部暖光池)
    const lg = new T.Group();
    lg.add(place(new T.Mesh(new T.CylinderGeometry(0.22, 0.26, 0.08, 18), mat(0x2a2620, { metal: 0.3, rough: 0.6 })), 0, 0.04, 0));
    lg.add(place(new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 3.0, 10), mat(0x2a2620, { metal: 0.4, rough: 0.5 })), 0, 1.5, 0));
    const shadeMat = mat(0xffcf9a, { rough: 0.5, emissive: 0xff9a4a, emi: 0.5 });
    const shade = new T.Mesh(new T.CylinderGeometry(0.34, 0.46, 0.5, 20, 1, true), shadeMat);
    shade.position.set(0, 3.05, 0); shade.castShadow = false; lg.add(shade);
    lg.add(place(new T.Mesh(new T.SphereGeometry(0.09, 12, 12), mat(0xfff0c8, { emissive: 0xffcf87, emi: 1.3, rough: 1 })), 0, 3.0, 0));
    const light = new T.PointLight(0xffb070, 1.3, 7.5, 2);
    light.position.set(0, 2.96, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.near = 0.2; light.shadow.camera.far = 9;
    light.shadow.bias = -0.0015;
    lg.add(light);
    lg.position.set(cx + 0.7, 0, cz - 0.6);
    scene.add(lg);
    refs.floorLamp = lg;
  }

  // 靠左墙的小书架 + 几本彩色书
  function buildBookshelf() {
    const g = new T.Group();
    const wood = mat(0x5a3f2e, { rough: 0.8 });
    const W = 1.8, H = 2.4, D = 0.5, th = 0.07;
    g.add(place(new T.Mesh(new T.BoxGeometry(th, H, D), wood), -W / 2, H / 2, 0)); // 左板
    g.add(place(new T.Mesh(new T.BoxGeometry(th, H, D), wood), W / 2, H / 2, 0));  // 右板
    g.add(place(new T.Mesh(new T.BoxGeometry(W, th, D), wood), 0, H, 0));          // 顶板
    g.add(place(new T.Mesh(new T.BoxGeometry(W, th, D), wood), 0, 0.03, 0));       // 底板
    g.add(place(new T.Mesh(new T.BoxGeometry(W, H, th), wood), 0, H / 2, -D / 2 + th / 2)); // 背板
    const cols = [0x9c4a4a, 0x4a6a8a, 0xc9a24a, 0x4a7a5a, 0x7a4a7a, 0xb5713f];
    const shelves = 3;
    for (let s = 1; s <= shelves; s++) {
      const y = (H / (shelves + 1)) * s;
      g.add(place(new T.Mesh(new T.BoxGeometry(W - th, th, D), wood), 0, y, 0)); // 隔板
      let bx = -W / 2 + 0.15;
      while (bx < W / 2 - 0.2) {
        const bw = R(0.07, 0.13), bh = R(0.34, 0.5);
        const book = new T.Mesh(new T.BoxGeometry(bw, bh, R(0.3, 0.42)),
          mat(cols[Math.floor(R(0, cols.length))], { rough: 0.9 }));
        book.position.set(bx + bw / 2, y + bh / 2 + th / 2, R(-0.04, 0.06));
        g.add(book);
        bx += bw + 0.015;
      }
    }
    g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    g.position.set(-4.6, 0, -1.2);
    scene.add(g);
    refs.bookshelf = g;
  }

  // 左墙挂画:画框 + 彩色画芯(微自发光,夜里不至于全黑)
  function buildWallArt() {
    const g = new T.Group();
    const frameMat = mat(0x2a2233, { rough: 0.6 });
    const arts = [
      { z: -1.2, y: 3.7, w: 1.0, h: 1.3, art: 0x3a5a7a },
      { z: 0.7, y: 3.3, w: 1.2, h: 0.9, art: 0xb5734a },
    ];
    arts.forEach((a) => {
      const frame = new T.Mesh(new T.BoxGeometry(0.06, a.h, a.w), frameMat);
      frame.position.set(-4.84, a.y, a.z); frame.receiveShadow = true; g.add(frame);
      const face = new T.Mesh(new T.BoxGeometry(0.02, a.h - 0.14, a.w - 0.14),
        mat(a.art, { rough: 0.8, emissive: a.art, emi: 0.1 }));
      face.position.set(-4.8, a.y, a.z); g.add(face);
    });
    scene.add(g);
    refs.wallArt = g;
  }

  // 城市:稀疏 + 远离房间的一圈天际线(数量/距离/高度可重建)
  function buildCity(p) {
    const city = new T.Group();
    for (let k = 0; k < p.count; k++) {
      let ang;
      do { ang = R(0, Math.PI * 2); } while (ang > 0.12 && ang < 1.45); // 跳过朝相机的开口
      const r = R(p.rInner, p.rOuter);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const h = R(p.hMin, p.hMax), w = R(p.wMin, p.wMax), dp = R(p.wMin, p.wMax);
      const b = box(w, h, dp, R(0, 1) > 0.5 ? 0x0e1430 : 0x121a38, { cast: false, recv: false, rough: 1 });
      b.position.set(x, h / 2, z); city.add(b);
      // 朝向房间的一面点几盏窗灯
      const dir = new T.Vector3(-x, 0, -z).normalize();
      for (let wy = 0.7; wy < h - 0.5; wy += 0.8) {
        if (Math.random() < p.winChance) {
          const warm = Math.random() > 0.5;
          const win = new T.Mesh(new T.PlaneGeometry(0.16, 0.24),
            new T.MeshBasicMaterial({ color: warm ? 0xffcf87 : 0x6e86b8, transparent: true, opacity: R(0.4, 0.85) }));
          win.position.set(x + dir.x * (dp / 2 + 0.02) + R(-w / 4, w / 4), wy, z + dir.z * (dp / 2 + 0.02));
          win.lookAt(0, wy, 0);
          city.add(win);
        }
      }
    }
    return city;
  }

  /* ============================== 氛围:雨 / 微尘 / 蒸汽 ============================== */
  function makePoints(n, color, size, opacity, fill) {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) fill(pos, i * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    const m = new T.PointsMaterial({ color, size, transparent: true, opacity, sizeAttenuation: true, depthWrite: false });
    const p = new T.Points(geo, m);
    p.userData.pos = pos;
    return p;
  }

  function buildAtmosphere() {
    // 窗外雨:环绕房间四周下落
    const RN = 1500;
    rain = makePoints(RN, COL.rain, 0.07, 0.6, (a, i) => {
      const ang = R(0, Math.PI * 2), r = R(7, 16);
      a[i] = Math.cos(ang) * r; a[i + 1] = R(0, 16); a[i + 2] = Math.sin(ang) * r;
    });
    rain.userData.v = new Float32Array(RN);
    for (let i = 0; i < RN; i++) rain.userData.v[i] = R(7, 12);
    scene.add(rain);
    refs.rain = rain;

    // 灯光微尘(室内,聚在台灯附近)
    dust = makePoints(90, COL.dust, 0.05, 0.45, (a, i) => {
      a[i] = R(-3, 1); a[i + 1] = R(0.4, 4.2); a[i + 2] = R(-4.4, -1.6);
    });
    scene.add(dust);
    refs.dust = dust;

    // 马克杯蒸汽
    steam = makePoints(28, COL.steam, 0.06, 0.3, (a, i) => {
      a[i] = 1.45 + R(-0.05, 0.05); a[i + 1] = R(2.5, 3.5); a[i + 2] = -2.8 + R(-0.05, 0.05);
    });
    scene.add(steam);
    refs.steam = steam;
  }

  /* ============================== 渲染循环 ============================== */
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // 雨下落
    if (rain && rain.visible) {
      const p = rain.userData.pos, v = rain.userData.v;
      for (let i = 0; i < v.length; i++) {
        const y = i * 3 + 1;
        p[y] -= v[i] * dt;
        if (p[y] < 0) {
          p[y] += 16;
          const ang = R(0, Math.PI * 2), r = R(7, 16);
          p[i * 3] = Math.cos(ang) * r; p[i * 3 + 2] = Math.sin(ang) * r;
        }
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }
    // 微尘缓慢上浮飘移
    if (dust) {
      const p = dust.userData.pos;
      for (let i = 0; i < p.length; i += 3) {
        p[i] += Math.sin(t * 0.3 + i) * 0.0016;
        p[i + 1] += 0.0035;
        if (p[i + 1] > 4.4) p[i + 1] = 0.4;
      }
      dust.geometry.attributes.position.needsUpdate = true;
    }
    // 蒸汽上升并回收
    if (steam) {
      const p = steam.userData.pos;
      for (let i = 0; i < p.length; i += 3) {
        p[i + 1] += 0.006;
        p[i] += Math.sin(t * 0.8 + i) * 0.001;
        if (p[i + 1] > 4.0) { p[i + 1] = 2.5; p[i] = 1.45 + R(-0.05, 0.05); }
      }
      steam.geometry.attributes.position.needsUpdate = true;
    }

    // 串灯轻微闪烁(暖味呼吸感;幅度很小)
    if (refs.fairy) {
      for (let i = 0; i < refs.fairy.length; i++) {
        const fl = refs.fairy[i];
        fl.mat.emissiveIntensity = fl.base * (0.82 + 0.18 * Math.sin(t * 1.5 + fl.phase));
      }
    }

    // 极缓慢镜头微动(非鼠标);reduced-motion 或编辑模式(drift 关)下不接管相机
    if (driftEnabled && !reduce) {
      camera.position.set(
        camBase.x + Math.sin(t * 0.12) * 0.32,
        camBase.y + Math.sin(t * 0.16) * 0.16,
        camBase.z + Math.cos(t * 0.10) * 0.32
      );
      camera.lookAt(camTarget);
    }

    // 外部帧回调(editor 的 OrbitControls.update 等)
    for (let i = 0; i < frameCallbacks.length; i++) frameCallbacks[i](dt, t);

    renderer.render(scene, camera);
  }

  function onResize() {
    if (!renderer || !camera) return;
    applyFrustum(camera, PARAMS.camera.frustum);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ============================== 编辑器 API ============================== */
  // 即时生效(改属性,无需重建几何)
  function apply(group) {
    if (!scene) return;
    switch (group) {
      case "camera": {
        // 只改投影(视野/缩放);相机位置/朝向在编辑模式由 OrbitControls 接管,
        // 由 editor 的 orbit 'change' 写回 camBase/camTarget,故这里不强制重定位相机。
        const c = PARAMS.camera;
        camBase.set(c.posX, c.posY, c.posZ);
        camTarget.set(c.targetX, c.targetY, c.targetZ);
        camera.zoom = c.zoom;
        applyFrustum(camera, c.frustum);
        camera.updateProjectionMatrix();
        break;
      }
      case "backdrop": applyBackdrop(); break;
      case "lighting": {
        const l = PARAMS.lighting;
        refs.hemiLight.intensity = l.hemiInt;
        refs.ambLight.intensity = l.ambInt;
        refs.moonLight.intensity = l.moonInt;
        refs.moonLight.color.setHex(l.moonColor);
        refs.moonLight.position.set(l.moonX, l.moonY, l.moonZ);
        refs.screenLight.intensity = l.screenInt;
        renderer.toneMappingExposure = l.exposure;
        scene.fog.color.setHex(l.fogColor);
        scene.fog.density = l.fogDensity;
        break;
      }
      case "lamp": {
        const p = PARAMS.lamp;
        refs.lampGroup.position.set(p.x, LAMP_BASE_Y + p.y, p.z);
        refs.lampGroup.scale.setScalar(p.scale);
        refs.lampLight.intensity = p.lightInt;
        refs.lampLight.color.setHex(p.lightColor);
        refs.lampBulbMat.emissiveIntensity = p.bulbEmi;
        refs.lampShadeMat.color.setHex(p.shadeColor);
        break;
      }
      case "bed": {
        const p = PARAMS.bed;
        refs.bedGroup.position.set(p.x, 0, p.z);
        refs.bedGroup.scale.setScalar(p.scale);
        refs.bedFrameMats.forEach((m) => m.color.setHex(p.frameColor));
        refs.bedMattressMat.color.setHex(p.mattressColor);
        break;
      }
      case "person": {
        const p = PARAMS.person;
        refs.personGroup.position.set(p.x, 0, p.z);
        refs.personGroup.scale.setScalar(p.scale);
        refs.personSkinMats.forEach((m) => m.color.setHex(p.skinColor));
        refs.personHoodieMats.forEach((m) => m.color.setHex(p.bodyColor));
        refs.personHairMats.forEach((m) => m.color.setHex(p.hairColor));
        break;
      }
      case "rug": {
        const p = PARAMS.rug;
        refs.rugMesh.position.set(p.x, 0.03, p.z);
        refs.rugMesh.scale.set(p.w / RUG_BASE_W, 1, p.d / RUG_BASE_D);
        refs.rugMat.color.setHex(p.color);
        break;
      }
      case "moon": {
        const p = PARAMS.moon;
        refs.moonMesh.position.set(p.x, p.y, p.z);
        refs.moonMesh.scale.setScalar(p.size / MOON_BASE_R);
        refs.moonMat.emissiveIntensity = p.emi;
        if (refs.moonHalo) { refs.moonHalo.position.copy(refs.moonMesh.position); refs.moonHalo.scale.copy(refs.moonMesh.scale); }
        break;
      }
    }
  }

  // 结构变化:销毁旧几何 + 重建
  function rebuild(part) {
    if (!scene) return;
    if (part === "city") {
      if (refs.cityGroup) { scene.remove(refs.cityGroup); disposeObj(refs.cityGroup); }
      refs.cityGroup = buildCity(PARAMS.city);
      scene.add(refs.cityGroup);
      applyBackdrop();   // 新城市组默认在 y=0,重新下移到 horizonY,否则地平线视觉上被置零
    } else if (part === "quilt") {
      if (refs.quiltMesh && refs.bedGroup) { refs.bedGroup.remove(refs.quiltMesh); disposeObj(refs.quiltMesh); }
      refs.quiltMesh = buildQuilt(PARAMS.quilt);
      refs.bedGroup.add(refs.quiltMesh);
    }
  }

  function setDrift(on) {
    driftEnabled = !!on;
    if (!driftEnabled && camera) { camera.position.copy(camBase); camera.lookAt(camTarget); }
  }
  function addFrameCallback(fn) { if (typeof fn === "function") frameCallbacks.push(fn); }

  /* —— 供 app.js 调用:雨声开关联动窗外雨 —— */
  function setRain(on) { if (rain) rain.visible = !!on; }

  return {
    init, setRain, setDrift, addFrameCallback,
    apply, rebuild,
    params: PARAMS,
    refs: () => refs,
    three: () => ({ scene, camera, renderer }),
  };
})();
