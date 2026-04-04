// phase_space.js — Takens delay-coordinate embedding visualiser.
//
// Two render primitives (toggled at runtime, same geometry + shader):
//   Points — glowing dot cloud
//   Lines  — continuous trajectory polyline
//
// Two colour modes:
//   age   — monochrome glow fading by trail age
//   pitch — hue from velocity-weighted circular mean of active pitch classes

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MAX_PTS = 200_000;

// ── Module state ───────────────────────────────────────────────────────────────
let renderer, scene, camera, orbit, mat, ptMesh, lineMesh, geo;
let positions;    // Float32Array  MAX_PTS × 3
let hues;         // Float32Array  MAX_PTS     — pitch-class hue per point
let filteredBuf;
let writeHead   = 0;
let activeCount = 0;
let lpState     = 0;
let prevNow     = null;
let prevMode3d  = null;

// ── Autocam state ──────────────────────────────────────────────────────────────
let autocamOn  = false;
let autocamT   = 0;                          // seconds elapsed while autocam is on
const AC_W1    = (2 * Math.PI) / 23;         // azimuth: full orbit every 23 s
const AC_W2    = (2 * Math.PI) / 17;         // elevation: cycle every 17 s (irrational ratio → path never repeats)
const _acTgt   = new THREE.Vector3();        // smoothed look-at target
const _acTmp   = new THREE.Vector3();        // scratch vector
let   acDist   = 3.0;                        // smoothed camera distance

// ── GLSL ──────────────────────────────────────────────────────────────────────
const VS = /* glsl */`
  attribute float aHue;
  uniform float uHead;
  uniform float uTrail;
  uniform float uSize;
  uniform float uPitchMode;
  uniform vec3  uNew;
  uniform vec3  uOld;

  varying float vAge;
  varying vec3  vCol;

  // HSL → RGB  (s = 1, l = 0.55  →  c = 0.9, m = 0.1)
  vec3 hue2rgb(float h) {
    float hp = mod(h / 60.0, 6.0);
    float x  = 0.9 * (1.0 - abs(mod(hp, 2.0) - 1.0));
    vec3 col;
    if      (hp < 1.0) col = vec3(0.9, x,   0.0);
    else if (hp < 2.0) col = vec3(x,   0.9, 0.0);
    else if (hp < 3.0) col = vec3(0.0, 0.9, x  );
    else if (hp < 4.0) col = vec3(0.0, x,   0.9);
    else if (hp < 5.0) col = vec3(x,   0.0, 0.9);
    else               col = vec3(0.9, 0.0, x  );
    return col + 0.1;
  }

  void main() {
    float idx = float(gl_VertexID);
    // + 1.0 ensures the ring-wrap slot always has age ≥ MAX_PTS+1 → fully faded,
    // and the newest written point has age = 1 (not 0).
    float raw = mod(uHead - idx + ${MAX_PTS}.0, ${MAX_PTS}.0) + 1.0;
    vAge = clamp(raw / uTrail, 0.0, 1.0);

    vCol = uPitchMode > 0.5
      ? hue2rgb(aHue)
      : mix(uNew, uOld, sqrt(vAge));

    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (1.0 - vAge * 0.65);
  }
`;

const FS = /* glsl */`
  uniform float uIsLines;   // 0 = points (apply disc clip), 1 = lines (skip it)
  varying float vAge;
  varying vec3  vCol;

  void main() {
    if (uIsLines < 0.5) {
      // Circular sprite for point mode
      if (dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) > 0.25) discard;
    }
    float alpha  = pow(1.0 - vAge, 1.6);
    gl_FragColor = vec4(vCol * alpha, alpha);
  }
`;

// ── Colour presets (age mode) ──────────────────────────────────────────────────
export const COLOR_SCHEMES = {
  plasma: { label: 'Plasma',  newColor: '#ffffff', oldColor: '#04083a' },
  fire:   { label: 'Fire',    newColor: '#ffee66', oldColor: '#1a0000' },
  aurora: { label: 'Aurora',  newColor: '#00ffcc', oldColor: '#001a0f' },
  violet: { label: 'Violet',  newColor: '#ee88ff', oldColor: '#0a001a' },
  lime:   { label: 'Lime',    newColor: '#ccff44', oldColor: '#010e00' },
};

// ── Init ──────────────────────────────────────────────────────────────────────
export function init(container) {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
  container.appendChild(renderer.domElement);

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.001, 100);
  camera.position.set(1.8, 1.2, 1.8);
  camera.lookAt(0, 0, 0);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.06;

  const ax = new THREE.AxesHelper(1.05);
  ax.material.transparent = true;
  ax.material.opacity     = 0.18;
  scene.add(ax);

  positions = new Float32Array(MAX_PTS * 3);
  hues      = new Float32Array(MAX_PTS);

  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aHue',     new THREE.BufferAttribute(hues,      1));
  geo.setDrawRange(0, 0);

  mat = new THREE.ShaderMaterial({
    vertexShader:   VS,
    fragmentShader: FS,
    uniforms: {
      uHead:      { value: 0 },
      uTrail:     { value: 5000 },
      uSize:      { value: 2.5 },
      uPitchMode: { value: 0 },
      uIsLines:   { value: 0 },
      uNew:       { value: new THREE.Color('#ffffff') },
      uOld:       { value: new THREE.Color('#04083a') },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });

  // Two meshes sharing the same geometry + material.
  // Only one is visible at a time based on the drawLines param.
  ptMesh   = new THREE.Points(geo, mat);
  lineMesh = new THREE.Line(geo, mat);
  lineMesh.visible = false;
  scene.add(ptMesh);
  scene.add(lineMesh);

  _applySize(container);
}

export function resize(container) { _applySize(container); }

function _applySize(container) {
  if (!renderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight || container.parentElement?.clientHeight || 400;
  renderer.setSize(w, h, false);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}

// ── Autocam ───────────────────────────────────────────────────────────────────
function _runAutocam(dt) {
  if (!autocamOn || activeCount === 0) return;
  autocamT += dt;

  // Sample up to 1000 recent points for centroid + bounding box (single pass).
  const N = Math.min(activeCount, 1000);
  let cx = 0, cy = 0, cz = 0, valid = 0;
  let minX =  Infinity, maxX = -Infinity;
  let minY =  Infinity, maxY = -Infinity;
  let minZ =  Infinity, maxZ = -Infinity;

  for (let i = 0; i < N; i++) {
    const idx = ((writeHead - 1 - i) + MAX_PTS) % MAX_PTS;
    const b   = idx * 3;
    const x = positions[b], y = positions[b + 1], z = positions[b + 2];
    if (!isFinite(x)) continue;
    cx += x; cy += y; cz += z; valid++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (valid === 0) return;

  cx /= valid; cy /= valid; cz /= valid;

  // Smoothly track centroid.
  _acTgt.lerp(_acTmp.set(cx, cy, cz), 0.02);

  // Adapt distance so the attractor fills ~80 % of the frame.
  const spread     = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.1) * 0.5;
  const fovRad     = camera.fov * Math.PI / 180;
  const wantedDist = Math.max(1.2, Math.min(7, (spread / Math.tan(fovRad / 2)) * 1.25));
  acDist += (wantedDist - acDist) * 0.005;

  // Lissajous sphere path: irrational frequency ratio means path never exactly repeats.
  const az = AC_W1 * autocamT;
  const el = 0.5 * Math.sin(AC_W2 * autocamT);   // ± 0.5 rad  ≈ ± 29°

  camera.position.set(
    _acTgt.x + acDist * Math.cos(el) * Math.sin(az),
    _acTgt.y + acDist * Math.sin(el),
    _acTgt.z + acDist * Math.cos(el) * Math.cos(az),
  );
  camera.lookAt(_acTgt);
  orbit.target.copy(_acTgt);
}

// ── Per-frame update ───────────────────────────────────────────────────────────
export function update(analyserNode, params) {
  if (!renderer) return;

  // dt is needed by both the write loop and autocam — compute it unconditionally.
  const now = performance.now();
  const dt  = prevNow === null ? 1 / 60 : Math.min((now - prevNow) / 1000, 0.15);
  prevNow   = now;

  const { autocam = false } = params ?? {};
  if (autocam !== autocamOn) {
    if (autocam) {
      // Initialise from current camera state so there's no jump on enable.
      _acTgt.copy(orbit.target);
      acDist   = camera.position.distanceTo(orbit.target);
      autocamT = 0;
      orbit.enableRotate = false;
      orbit.enablePan    = false;
    } else {
      orbit.enableRotate = true;
      orbit.enablePan    = true;
    }
  }
  autocamOn = autocam;

  if (!analyserNode) {
    orbit.update();
    _runAutocam(dt);
    renderer.render(scene, camera);
    return;
  }

  const {
    tauMs          = 2,
    stride         = 8,
    trailSec       = 5,
    lpCutoffHz     = 5800,
    mode3d         = true,
    pointSize      = 2.5,
    colorScheme    = 'plasma',
    phaseColorMode = 'age',
    noteHue        = 0,
    drawLines      = false,
  } = params;

  const sr    = analyserNode.context.sampleRate;
  const fsz   = analyserNode.fftSize;
  const tau   = Math.max(1, Math.round(tauMs * sr / 1000));
  const trail = Math.min(MAX_PTS, Math.round(trailSec * sr / stride));
  const lpA   = 1 - Math.exp(-2 * Math.PI * lpCutoffHz / sr);

  if (!filteredBuf || filteredBuf.length !== fsz) {
    filteredBuf = new Float32Array(fsz);
    lpState = 0;
    prevNow = null;
  }

  analyserNode.getFloatTimeDomainData(filteredBuf);
  for (let i = 0; i < fsz; i++) {
    lpState        = lpA * filteredBuf[i] + (1 - lpA) * lpState;
    filteredBuf[i] = lpState;
  }

  const newSamples = Math.min(Math.round(dt * sr), fsz - 2 * tau - 1);
  const startIdx   = Math.max(0, fsz - 2 * tau - newSamples);
  const endIdx     = fsz - 2 * tau;

  for (let i = startIdx; i < endIdx; i += stride) {
    const b = writeHead * 3;
    positions[b]     = filteredBuf[i];
    positions[b + 1] = filteredBuf[i + tau];
    positions[b + 2] = filteredBuf[i + 2 * tau];
    hues[writeHead]  = noteHue;
    writeHead = (writeHead + 1) % MAX_PTS;
    if (activeCount < MAX_PTS) activeCount++;
  }

  // When the ring is full, mark the oldest slot (writeHead) as NaN so that
  // THREE.Line discards the segment bridging newest → oldest (wrap boundary).
  // The NaN is overwritten with real data on the next write to this slot.
  if (activeCount === MAX_PTS) {
    const nb = writeHead * 3;
    positions[nb] = positions[nb + 1] = positions[nb + 2] = NaN;
  }

  geo.attributes.position.needsUpdate = true;
  geo.attributes.aHue.needsUpdate     = true;
  geo.setDrawRange(0, activeCount);

  if (mode3d !== prevMode3d) {
    prevMode3d = mode3d;
    if (mode3d) {
      camera.position.set(1.8, 1.2, 1.8);
      orbit.enableRotate = true;
    } else {
      camera.position.set(0, 0, 3.2);
      orbit.enableRotate = false;
    }
    camera.lookAt(0, 0, 0);
    orbit.target.set(0, 0, 0);
    orbit.update();
  }

  const cs = COLOR_SCHEMES[colorScheme] ?? COLOR_SCHEMES.plasma;
  const u  = mat.uniforms;
  u.uHead.value      = writeHead;
  u.uTrail.value     = trail;
  u.uSize.value      = pointSize;
  u.uPitchMode.value = phaseColorMode === 'pitch' ? 1 : 0;
  u.uIsLines.value   = drawLines ? 1 : 0;
  u.uNew.value.set(cs.newColor);
  u.uOld.value.set(cs.oldColor);

  ptMesh.visible   = !drawLines;
  lineMesh.visible =  drawLines;

  orbit.update();
  _runAutocam(dt);
  renderer.render(scene, camera);
}

// ── Reset ─────────────────────────────────────────────────────────────────────
export function reset() {
  writeHead = activeCount = 0;
  lpState   = 0;
  prevNow   = null;
  prevMode3d = null;
  if (positions) positions.fill(0);
  if (hues)      hues.fill(0);
  if (geo) {
    geo.setDrawRange(0, 0);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aHue.needsUpdate     = true;
  }
}

// ── Destroy ───────────────────────────────────────────────────────────────────
export function destroy() {
  if (!renderer) return;
  renderer.dispose();
  renderer.domElement.remove();
  renderer = scene = camera = orbit = mat = ptMesh = lineMesh = geo = null;
  positions = hues = filteredBuf = null;
  writeHead = activeCount = 0;
  lpState = 0;
  prevNow = prevMode3d = null;
}
