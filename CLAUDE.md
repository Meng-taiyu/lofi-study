# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page, no-build lo-fi study room: a **real-time 3D isometric scene** (a cozy night study room — desk, lamp, laptop, a person in headphones, a window with moon/city/rain outside) rendered with **Three.js**, overlaid with a clock, 考研 (grad-school exam) countdown, pomodoro timer, and **real-time generative** lo-fi music + rain synthesized in the browser via Web Audio — no audio files. The visual mood is **cool/warm contrast** (cool night ambience + one warm desk lamp). UI text is Chinese.

> The scene used to be flat SVG/Canvas "simple illustration" layers; it was rewritten to a Three.js isometric 3D room. Three.js is vendored locally (`vendor/three.min.js`, r128 UMD) so the page works offline and via `file://`.

## Running

No build step, no npm, no tests. Open `index.html` directly (vendored Three.js means `file://` double-click works), or serve the folder (`python3 -m http.server`) and open it. Audio cannot start until the user clicks **点击进入** on the gate (browser autoplay policy; see below). The 3D scene renders immediately, behind the gate.

> **Furniture GLB needs http.** The Kenney furniture models (`models/furniture/*.glb`, loaded via `GLTFLoader`) are fetched by XHR, which Chrome blocks over `file://` (CORS). Served over http (`python3 -m http.server` or GitHub Pages) they load fine; over a plain `file://` double-click the load fails and the scene **gracefully falls back to the primitive furniture** — the 3D room and all UI still work, you just don't see the GLB models. So for the full look, serve the folder.

## Architecture

Files, each one concern: `index.html` (one `<canvas>` + UI + gate), `styles.css` (UI/overlays + look), `scene3d.js` (**all** Three.js — the 3D scene), `app.js` (all non-visual logic), `vendor/three.min.js` (the library). No framework, no modules — classic `<script>` tags.

**Script load order matters** (`index.html`, end of `<body>`): `vendor/three.min.js` → `scene3d.js` → `app.js`. `scene3d.js` defines `window.Scene3D` at parse time; `app.js`'s `main()` (on `DOMContentLoaded`) calls `Scene3D.init()`. `THREE` and `Scene3D` must both exist before `app.js` runs.

### Compositing (z-stack)

The visible result is the WebGL canvas plus CSS overlays, composited by `z-index` (`styles.css`):
1. `#scene3d` (canvas, z1) — the Three.js 3D room (opaque, fills viewport).
2. `.vignette` (z4) and `.grain` (z5) — CSS-only post effects layered on top of the 3D render for a cinematic feel.
3. `#ui` (z10) — glassmorphism panels; `pointer-events` gated so only panels are clickable.
4. `#gate` (z20) — entry overlay, removed via `.gone` class.

### The 3D scene (`scene3d.js`, the `Scene3D` IIFE)

Self-contained module exposing `Scene3D.init()` (build + start render loop) and `Scene3D.setRain(on)` (show/hide the outside rain — called from `app.js`'s `toggleRain` so the ☂ button controls **both** rain audio and the visual rain).

- **Camera:** `OrthographicCamera` for a clean isometric look (orthographic = no perspective distortion). The **main scene is interactive** via the vendored **camera-controls** library (yomotsu, `vendor/camera-controls.js`, classic-global build): left-drag rotates, right-drag pans (truck), wheel zooms — all with damping for a smooth feel. Azimuth/polar/zoom are **limited** so you can never see the L-shaped cutaway room's missing walls; after ~8s idle the camera smoothly returns to the default framing (`setLookAt(..., true)`), and under `prefers-reduced-motion` it stays put (no auto-return). `setupControls()` **skips `?edit`** so the editor keeps using its own OrbitControls (no double-controller conflict). The controller drives the render loop via `addFrameCallback(dt => controls.update(dt))` and disables the old auto-drift. Exposed as `Scene3D.controls()` and `Scene3D.resetView()`. (Historical note: an earlier mouse-*parallax* attempt was rejected; this is full orbit/truck/zoom, a deliberate later change — don't revert it to "fixed camera".)
- **Room:** an L-shaped cutaway diorama (floor + back wall + left wall), open toward the camera. The back wall is built from four boxes framing a **window** opening.
- **Lighting = the cool/warm contrast** (the core of the look): cool `HemisphereLight`/`AmbientLight` night fill + a cool `DirectionalLight` "moonlight" through the window (the main shadow caster) on the cool side; a warm `PointLight` at the desk lamp (warm pool, also casts shadows) on the warm side; a small cool light at the laptop screen. `PCFSoftShadowMap`, `ACESFilmicToneMapping`, `sRGBEncoding`, cool `FogExp2`.
- **Furniture:** built from primitives (box/cylinder/cone/sphere/torus/icosahedron), low-poly feel via `flatShading`. Desk, chair, lamp, laptop, books, mug, plant, rug, and a seated headphoned figure facing the window. **Bookshelf, bed, floor lamp, and a potted-plant prop are swapped to Kenney CC0 GLB models** (`models/furniture/`, vendored `vendor/GLTFLoader.js`) via `loadFurnitureGLB(url, group, opts)`: it auto-fits the model to the primitive's bounding-box height, drops it on the floor centred, enables shadows, and **replaces the primitive meshes in the same `Group` while preserving children marked `userData.keep`** (the floor lamp's `PointLight` + emissive bulb stay). Because the `Group` ref / position / scale are untouched, `apply()` and the editor's TransformControls keep working with zero changes. Load failure (e.g. `file://`) is a no-op, so the primitives remain. A few **additive decor props** (nightstand + a plant on it, a lounge chair) are also loaded through the same helper into fresh empty groups (no primitive fallback). Desk/chair/person stay primitive (tightly coupled to desktop items / the seated figure) — queued for later.
- **Outside the window:** night-sky plane, emissive moon + halo, a generated city silhouette with a few lit windows, all lit cool.
- **Atmosphere:** `Points` systems for outside rain (toggled by `setRain`), drifting dust in the lamp light, and mug steam. Animated in the single `requestAnimationFrame` loop, which pauses on `visibilitychange` (hidden tab) to save power.

**Tuning knobs** are constants at the top of `scene3d.js`: `CAM_POS`, `CAM_TARGET`, `FRUSTUM` (ortho zoom), `CAM_DRIFT` (the idle camera motion toggle), and the whole `COL` color palette. Geometry positions are in **3D world units** (floor at y=0, room ≈10×10, walls h≈6) — the old flat 1600×900 SVG coordinate system no longer applies.

### Web Audio engine (`app.js`, the `Audio` object)

Music is generated live, not played back. Signal graph: per-note sources → `musicBus` → `master` → `destination`; rain audio is a separate looping noise buffer → bandpass → `rainGain` → `master`. A shared convolution `reverb` (with a low-pass to tame synthetic fizz) is the send target exposed as `Audio._revIn` — voices that want reverb call `g.connect(Audio._revIn)`.

Timing uses the standard **lookahead scheduler**: `scheduler()` runs on a 25ms `setInterval` and schedules any 16th-note steps within the next 0.2s by exact `AudioContext` time (`nextTime`), so timing never depends on JS timer jitter. Tempo 72, 16 steps/bar with swing on odd steps, chord progression `PROG` (Dm7–G7–Cmaj7–Am7) advancing per bar, sparse pentatonic (`PENTA`) melody, kick on beats 1/3, soft snare on 2/4. Muting still advances `nextTime` so resuming doesn't jump.

**History worth knowing:** earlier commits deliberately *removed* the hi-hat, vinyl crackle, and harsh noise hits, and softened the snare — see `scheduleStep`'s comments. Don't reintroduce bright/noisy percussion without checking that intent.

### Autoplay gate

`AudioContext` is created only inside `enter()` (the gate button handler) because browsers block audio without a user gesture. `Audio.ctx` is null until then — guard accesses (as `chime()` does). The 3D scene does not depend on audio and runs from page load.

### Timer / clock

The `timer` object drives the pomodoro; `finishPhase()` auto-chains focus→break→focus and updates `document.title` so the countdown shows in the browser tab. Presets (25/5, 50/10, 90/20) are wired in `bindUI`. Spacebar toggles start/pause once past the gate.

## Configuration

Exam countdown: `EXAM_DATE` and `EXAM_LABEL` at the top of `app.js`. Motivational quotes: the `QUOTES` array. Visual look: the `COL` palette and camera constants at the top of `scene3d.js`.
