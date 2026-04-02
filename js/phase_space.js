// phase_space.js — Takens delay-coordinate embedding visualiser.
//
// Each audio sample becomes a point  x = (s(t), s(t+τ), s(t+2τ))  in 3-D
// space, accumulating a glowing trail that reveals the system's attractor.
// Newest points are bright; oldest fade to the background colour.
// The scene is fully interactive via Three.js OrbitControls.
//
// Mathematical basis: Takens' embedding theorem (1981) guarantees that for a
// smooth dynamical system the delay-coordinate map produces an attractor
// topologically equivalent to the original, provided embedding dimension ≥ 2d+1
// and τ is chosen well (first minimum of mutual information ≈ T_dominant / 4).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Ring-buffer capacity ───────────────────────────────────────────────────────
// At stride 4 and 44 100 Hz this holds ≈ 18 s of audio.
const MAX_PTS = 200_000;

// ── Module state ───────────────────────────────────────────────────────────────
let renderer, scene, camera, orbit, mat, mesh, geo;
let positions;      // Float32Array  MAX_PTS × 3
let filteredBuf;    // reused each frame for LP-filtered time-domain data
let writeHead   = 0;
let activeCount = 0;
let lpState     = 0;
let prevNow     = null;

// ── GLSL ──────────────────────────────────────────────────────────────────────
// Age per vertex computed on the GPU via gl_VertexID (requires WebGL 2, which
// Three.js r152+ uses by default). No CPU-side colour update needed.

const VS = /* glsl */`
  uniform float uHead;    // current write-head position in ring buffer
  uniform float uTrail;   // trail length in ring-buffer slots
  uniform float uSize;    // base point size (pixels)
  varying float vAge;     // 0 = newest, 1 = fully faded

  void main() {
    float idx  = float(gl_VertexID);
    float raw  = mod(uHead - idx + ${MAX_PTS}.0, ${MAX_PTS}.0);
    vAge = clamp(raw / uTrail, 0.0, 1.0);

    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (1.0 - vAge * 0.65);
  }
`;

const FS = /* glsl */`
  uniform vec3 uNew;    // colour of newest points
  uniform vec3 uOld;    // colour of oldest points (background hue)
  varying float vAge;

  void main() {
    // Circular sprite — discard corners
    if (dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5) > 0.25) discard;
    float alpha  = pow(1.0 - vAge, 1.6);
    gl_FragColor = vec4(mix(uNew, uOld, sqrt(vAge)) * alpha, alpha);
  }
`;

// ── Colour presets ─────────────────────────────────────────────────────────────
export const COLOR_SCHEMES = {
  plasma: { label: 'Plasma',  newColor: '#ffffff', oldColor: '#04083a' },
  fire:   { label: 'Fire',    newColor: '#ffee66', oldColor: '#1a0000' },
  aurora: { label: 'Aurora',  newColor: '#00ffcc', oldColor: '#001a0f' },
  violet: { label: 'Violet',  newColor: '#ee88ff', oldColor: '#0a001a' },
  lime:   { label: 'Lime',    newColor: '#ccff44', oldColor: '#010e00' },
};

// ── Initialise — call once, pass the container div ─────────────────────────────
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

  // Subtle axis guides (s(t), s(t+τ), s(t+2τ) axes)
  const ax = new THREE.AxesHelper(1.05);
  ax.material.transparent = true;
  ax.material.opacity     = 0.18;
  scene.add(ax);

  // Point cloud — positions updated CPU-side; colours computed GPU-side
  positions = new Float32Array(MAX_PTS * 3);
  geo       = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);

  mat = new THREE.ShaderMaterial({
    vertexShader:   VS,
    fragmentShader: FS,
    uniforms: {
      uHead:  { value: 0 },
      uTrail: { value: 5000 },
      uSize:  { value: 2.5 },
      uNew:   { value: new THREE.Color('#ffffff') },
      uOld:   { value: new THREE.Color('#04083a') },
    },
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });

  mesh = new THREE.Points(geo, mat);
  scene.add(mesh);

  _applySize(container);
}

// ── Resize — call after showing the container ──────────────────────────────────
export function resize(container) {
  _applySize(container);
}

function _applySize(container) {
  if (!renderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight || container.parentElement?.clientHeight || 400;
  renderer.setSize(w, h, false);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}

// ── Per-frame update ───────────────────────────────────────────────────────────
export function update(analyserNode, params) {
  if (!renderer) return;

  // No audio source: keep the scene interactive with the frozen portrait.
  if (!analyserNode) {
    orbit.update();
    renderer.render(scene, camera);
    return;
  }

  const {
    tauMs       = 2,
    stride      = 8,
    trailSec    = 5,
    lpCutoffHz  = 5800,
    mode3d      = true,
    pointSize   = 2.5,
    colorScheme = 'plasma',
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

  // Read time-domain signal and apply single-pole IIR low-pass filter.
  // The filter state (lpState) carries over between frames so phase is
  // continuous across frame boundaries.
  analyserNode.getFloatTimeDomainData(filteredBuf);
  for (let i = 0; i < fsz; i++) {
    lpState       = lpA * filteredBuf[i] + (1 - lpA) * lpState;
    filteredBuf[i] = lpState;
  }

  // Determine how many samples are genuinely new this frame, based on
  // elapsed wall time, and process only those to avoid duplicating points.
  const now        = performance.now();
  const dt         = prevNow === null ? 1 / 60 : Math.min((now - prevNow) / 1000, 0.15);
  prevNow          = now;
  const newSamples = Math.min(Math.round(dt * sr), fsz - 2 * tau - 1);
  const startIdx   = Math.max(0, fsz - 2 * tau - newSamples);
  const endIdx     = fsz - 2 * tau;

  // Write points into the ring buffer
  for (let i = startIdx; i < endIdx; i += stride) {
    const b = writeHead * 3;
    positions[b]     = filteredBuf[i];
    positions[b + 1] = filteredBuf[i + tau];
    positions[b + 2] = mode3d ? filteredBuf[i + 2 * tau] : 0;
    writeHead = (writeHead + 1) % MAX_PTS;
    if (activeCount < MAX_PTS) activeCount++;
  }

  geo.attributes.position.needsUpdate = true;
  geo.setDrawRange(0, activeCount);

  const cs = COLOR_SCHEMES[colorScheme] ?? COLOR_SCHEMES.plasma;
  mat.uniforms.uHead.value  = writeHead;
  mat.uniforms.uTrail.value = trail;
  mat.uniforms.uSize.value  = pointSize;
  mat.uniforms.uNew.value.set(cs.newColor);
  mat.uniforms.uOld.value.set(cs.oldColor);

  orbit.update();
  renderer.render(scene, camera);
}

// ── Clear accumulated trail ────────────────────────────────────────────────────
export function reset() {
  writeHead = activeCount = 0;
  lpState   = 0;
  prevNow   = null;
  if (positions) positions.fill(0);
  if (geo) {
    geo.setDrawRange(0, 0);
    geo.attributes.position.needsUpdate = true;
  }
}

// ── Tear down (call if removing the view) ─────────────────────────────────────
export function destroy() {
  if (!renderer) return;
  renderer.dispose();
  renderer.domElement.remove();
  renderer = scene = camera = orbit = mat = mesh = geo = null;
  positions = filteredBuf = null;
  writeHead = activeCount = 0;
  lpState = 0;
  prevNow = null;
}
