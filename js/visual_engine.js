// Visual renderer — two modes:
//   circles  concentric rings, phase varies with radius from canvas centre
//   grid     vertical + horizontal gratings summed, both axes normalised by W
//            so spacing is identical in x and y; phase = 0 at canvas centre
// Each note maps to a spatial frequency:  sf = sfScale * SF_REF * 2^((midi−60)/12)
// Multiple notes are combined via the chosen superposition mode.

const SF_REF      = 8;    // cycles/canvas-width at C4 (midi 60) with sfScale=1
const MIDI_REF    = 60;

let canvas, ctx;

export function init(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d', { willReadFrequently: false });
  const ro = new ResizeObserver(() => syncSize());
  ro.observe(canvas.parentElement);
  syncSize();
}

function syncSize() {
  const parent = canvas.parentElement;
  const W = Math.floor(parent.clientWidth)  || 800;
  const H = Math.floor(parent.clientHeight) || 400;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width  = W;
    canvas.height = H;
  }
}

// ── Waveforms (all output in [−1, 1]) ────────────────────────────────────────

const WAVEFORMS = {
  sine:     p => Math.sin(p),
  square:   p => Math.sign(Math.sin(p)) || 0,
  triangle: p => (2 / Math.PI) * Math.asin(Math.sin(p)),
  sawtooth: p => { const t = p / (2 * Math.PI); return 2 * (t - Math.floor(t)) - 1; },
};

// ── Superposition modes ───────────────────────────────────────────────────────
//
//  sum     — velocity-weighted mean; mean velocity sets overall contrast
//  product — product of raw waveforms, scaled by mean velocity
//            sin(a)·sin(b) = ½[cos(a−b)−cos(a+b)] → beat/difference freq visible
//  max     — dominant (loudest) note's grating wins at each pixel

function superpose(waveVals, amps, mode) {
  const N = waveVals.length;
  if (N === 0) return 0;

  // Mean velocity — used by all modes to translate loudness into grating amplitude
  let sumAmps = 0;
  for (let i = 0; i < N; i++) sumAmps += amps[i];
  const meanAmp = sumAmps / N;

  switch (mode) {
    case 'sum': {
      // Weighted mean: shape depends on per-note velocity, overall amplitude on mean velocity
      let s = 0;
      for (let i = 0; i < N; i++) s += amps[i] * waveVals[i];
      return s / N; // equals meanAmp when all wave values are 1
    }
    case 'product': {
      // Pure waveform product (preserves interval relationships), scaled by mean velocity
      let p = waveVals[0];
      for (let i = 1; i < N; i++) p *= waveVals[i];
      return p * meanAmp;
    }
    case 'max': {
      // Loudest note wins; both its velocity and waveform contribute
      let best = -Infinity, bestIdx = 0;
      for (let i = 0; i < N; i++) {
        const weighted = amps[i] * Math.abs(waveVals[i]);
        if (weighted > best) { best = weighted; bestIdx = i; }
      }
      return amps[bestIdx] * waveVals[bestIdx];
    }
    default: return 0;
  }
}

// ── Main render ───────────────────────────────────────────────────────────────


let _lastHyp;
export function render(activeNotes, opts) {
  const { showVisual, sfScale, waveform, superMode, renderMode, hyperbolic, tilt } = opts;
  if (hyperbolic !== _lastHyp) { console.log('[render] hyperbolic=', hyperbolic); _lastHyp = hyperbolic; }
  const W = canvas.width;
  const H = canvas.height;

  if (!showVisual) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(136,136,136,0.7)';
    ctx.font = `${Math.round(H * 0.06)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Visual: OFF', W / 2, H / 2);
    return;
  }

  const waveFn = WAVEFORMS[waveform] ?? WAVEFORMS.sine;
  const N = activeNotes.length;

  const sfs = activeNotes.map(n => sfScale * SF_REF * Math.pow(2, (n.midi - MIDI_REF) / 12));
  const amps = activeNotes.map(n => Math.min(1, n.velocity * Math.pow(2, tilt * (n.midi - MIDI_REF) / 12)));

  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  const cx = W / 2;
  const cy = H / 2;

  if (renderMode === 'grid') {
    // ── Grid mode (vertical + horizontal gratings summed) ─────────────────
    // Precompute 1-D wave arrays for x and y separately — O((W+H)·N) evals.
    // Per-pixel value for note i: (xWave[i][x] + yWave[i][y]) * 0.5  →  grid.
    // Normalising both axes by W gives the same cycles-per-pixel in x and y.
    // Hyperbolic: warp each axis via 2·atanh(|coord|/R)·sign; clip outside disk.
    const R = Math.min(cx, cy);  // inscribed-circle radius
    const EPS = 1e-6;

    const xWave = activeNotes.map((_, i) => {
      const row = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        let phase;
        if (hyperbolic) {
          const u = (x - cx) / R;
          phase = Math.abs(u) >= 1 ? 0 : 2 * Math.atanh(Math.min(Math.abs(u), 1 - EPS)) * Math.sign(u);
        } else {
          phase = (x - cx) / W;
        }
        row[x] = waveFn(2 * Math.PI * sfs[i] * phase);
      }
      return row;
    });
    const yWave = activeNotes.map((_, i) => {
      const col = new Float32Array(H);
      for (let y = 0; y < H; y++) {
        let phase;
        if (hyperbolic) {
          const v = (y - cy) / R;
          phase = Math.abs(v) >= 1 ? 0 : 2 * Math.atanh(Math.min(Math.abs(v), 1 - EPS)) * Math.sign(v);
        } else {
          phase = (y - cy) / W;
        }
        col[y] = waveFn(2 * Math.PI * sfs[i] * phase);
      }
      return col;
    });

    const waveVals = new Array(N);
    for (let y = 0; y < H; y++) {
      const dy   = y - cy;
      const base = y * W * 4;
      for (let x = 0; x < W; x++) {
        const dx = x - cx;
        // Outside Poincaré disk → grey boundary
        if (hyperbolic && (dx * dx + dy * dy) >= R * R) {
          const idx = base + x * 4;
          data[idx] = data[idx + 1] = data[idx + 2] = 128;
          data[idx + 3] = 255;
          continue;
        }
        for (let i = 0; i < N; i++)
          waveVals[i] = (xWave[i][x] + yWave[i][y]) * 0.5;
        const v    = superpose(waveVals, amps, superMode);
        const gray = Math.round(((v + 1) * 0.5) * 255);
        const idx  = base + x * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = gray;
        data[idx + 3] = 255;
      }
    }
  } else {
    // ── Circles mode ─────────────────────────────────────────────────────
    // Build a 1-D LUT indexed by integer radius — O(maxR·N) waveform evals
    // instead of O(W·H·N), then a simple lookup for each pixel.
    // Hyperbolic: replace rNorm with 2·atanh(rNorm); pixels outside unit disk → 128.
    const maxR    = Math.min(cx, cy);
    const maxRInt = Math.ceil(Math.sqrt(cx * cx + cy * cy)) + 1;
    const lutGray = new Uint8Array(maxRInt);
    const EPS = 1e-6;

    for (let ri = 0; ri < maxRInt; ri++) {
      const rNorm = ri / maxR;
      if (hyperbolic && rNorm >= 1) {
        lutGray[ri] = 128;
        continue;
      }
      const rPhase = hyperbolic ? 2 * Math.atanh(Math.min(rNorm, 1 - EPS)) : rNorm;
      const waveVals = new Array(N);
      for (let i = 0; i < N; i++)
        waveVals[i] = waveFn(2 * Math.PI * sfs[i] * rPhase);
      lutGray[ri] = Math.round(((superpose(waveVals, amps, superMode) + 1) * 0.5) * 255);
    }

    for (let y = 0; y < H; y++) {
      const dy   = y - cy;
      const base = y * W * 4;
      for (let x = 0; x < W; x++) {
        const dx   = x - cx;
        const gray = lutGray[Math.min(Math.round(Math.sqrt(dx * dx + dy * dy)), maxRInt - 1)];
        const idx  = base + x * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = gray;
        data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
