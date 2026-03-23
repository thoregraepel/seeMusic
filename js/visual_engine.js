// Visual renderer — two modes:
//   circles  concentric rings, phase varies with radius from canvas centre
//   grid     vertical + horizontal gratings summed, both axes normalised by W
//            so spacing is identical in x and y; phase = 0 at canvas centre
// Each note maps to a spatial frequency:  sf = sfScale * SF_REF * 2^((midi−60)/12)
// Multiple notes are combined via the chosen superposition mode.
//
// Color mode: each pitch class maps to a hue (30° steps around the colour wheel,
// C=0°/red). Per-pixel: amplitude-weighted sum of each note's grating value times
// its RGB colour vector, normalised by N, mapped from [−1,1] → [0,255] per channel.
// Trough of a note's grating shows its complementary colour; grey at zero-crossing.

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
  sawtooth:  p => { const t = p / (2 * Math.PI); return 2 * (t - Math.floor(t)) - 1; },
  sawtooth2: p => { const t = p / (2 * Math.PI); return 1 - 2 * (t - Math.floor(t)); },
  sawtooth2: p => { const t = p / (2 * Math.PI); return 1 - 2 * (t - Math.floor(t)); },
};

// ── Colour helpers ────────────────────────────────────────────────────────────
// HSL → RGB for the special case S=1, L=0.5 (pure saturated hues).
// h in degrees [0, 360).  Returns [r, g, b] each in [0, 1].

function hslToRgb(h) {
  const c = 1;                               // chroma = 1 when S=1, L=0.5
  const x = 1 - Math.abs((h / 60) % 2 - 1);
  let r, g, b;
  if      (h <  60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [r, g, b];
}

// Pitch class → hue: C=0°, C♯=30°, …, B=330°  (30° per semitone, full circle = octave)
const PITCH_RGB = Array.from({ length: 12 }, (_, pc) => hslToRgb(pc * 30));

// ── Superposition modes ───────────────────────────────────────────────────────
//
//  sum     — velocity-weighted mean; mean velocity sets overall contrast
//  product — product of raw waveforms, scaled by mean velocity
//            sin(a)·sin(b) = ½[cos(a−b)−cos(a+b)] → beat/difference freq visible
//  max     — dominant (loudest) note's grating wins at each pixel
//
//  Color mode always uses amplitude-weighted sum per channel (sum mode);
//  product and max do not have a natural per-channel colour equivalent.

function superpose(waveVals, amps, mode) {
  const N = waveVals.length;
  if (N === 0) return 0;

  let sumAmps = 0;
  for (let i = 0; i < N; i++) sumAmps += amps[i];
  const meanAmp = sumAmps / N;

  switch (mode) {
    case 'sum': {
      let s = 0;
      for (let i = 0; i < N; i++) s += amps[i] * waveVals[i];
      return s / N;
    }
    case 'product': {
      let p = waveVals[0];
      for (let i = 1; i < N; i++) p *= waveVals[i];
      return p * meanAmp;
    }
    case 'max': {
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

export function render(activeNotes, opts) {
  const { showVisual, sfScale, waveform, superMode, renderMode, hyperbolic, tilt, colorMode } = opts;
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

  const sfs  = activeNotes.map(n => sfScale * SF_REF * Math.pow(2, (n.midi - MIDI_REF) / 12));
  const amps = activeNotes.map(n => Math.min(1, n.velocity * Math.pow(2, tilt * (n.midi - MIDI_REF) / 12)));
  // Per-note RGB colour from pitch class (used in color mode)
  const noteRGB = colorMode ? activeNotes.map(n => PITCH_RGB[n.midi % 12]) : null;

  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  const cx = W / 2;
  const cy = H / 2;

  if (renderMode === 'grid') {
    // ── Grid mode ─────────────────────────────────────────────────────────
    const R   = Math.min(cx, cy);
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
    const k = N > 0 ? 1 / N : 1;

    for (let y = 0; y < H; y++) {
      const dy   = y - cy;
      const base = y * W * 4;
      for (let x = 0; x < W; x++) {
        const dx  = x - cx;
        const idx = base + x * 4;

        if (hyperbolic && (dx * dx + dy * dy) >= R * R) {
          data[idx] = data[idx + 1] = data[idx + 2] = 128;
          data[idx + 3] = 255;
          continue;
        }

        if (colorMode) {
          let sumR = 0, sumG = 0, sumB = 0;
          for (let i = 0; i < N; i++) {
            const aw = amps[i] * (xWave[i][x] + yWave[i][y]) * 0.5;
            sumR += aw * noteRGB[i][0];
            sumG += aw * noteRGB[i][1];
            sumB += aw * noteRGB[i][2];
          }
          data[idx]     = Math.round(((sumR * k + 1) * 0.5) * 255);
          data[idx + 1] = Math.round(((sumG * k + 1) * 0.5) * 255);
          data[idx + 2] = Math.round(((sumB * k + 1) * 0.5) * 255);
        } else {
          for (let i = 0; i < N; i++)
            waveVals[i] = (xWave[i][x] + yWave[i][y]) * 0.5;
          const gray = Math.round(((superpose(waveVals, amps, superMode) + 1) * 0.5) * 255);
          data[idx] = data[idx + 1] = data[idx + 2] = gray;
        }
        data[idx + 3] = 255;
      }
    }

  } else {
    // ── Circles mode ──────────────────────────────────────────────────────
    // 1-D LUT indexed by integer radius.
    // Color mode: three channel LUTs (R, G, B); grayscale: single lut.
    const maxR    = Math.min(cx, cy);
    const maxRInt = Math.ceil(Math.sqrt(cx * cx + cy * cy)) + 1;
    const EPS     = 1e-6;
    const k       = N > 0 ? 1 / N : 1;

    const lutR = new Uint8Array(maxRInt);
    const lutG = new Uint8Array(maxRInt);
    const lutB = new Uint8Array(maxRInt);

    for (let ri = 0; ri < maxRInt; ri++) {
      const rNorm = ri / maxR;
      if (hyperbolic && rNorm >= 1) {
        lutR[ri] = lutG[ri] = lutB[ri] = 128;
        continue;
      }
      const rPhase = hyperbolic ? 2 * Math.atanh(Math.min(rNorm, 1 - EPS)) : rNorm;

      if (colorMode) {
        let sumR = 0, sumG = 0, sumB = 0;
        for (let i = 0; i < N; i++) {
          const aw = amps[i] * waveFn(2 * Math.PI * sfs[i] * rPhase);
          sumR += aw * noteRGB[i][0];
          sumG += aw * noteRGB[i][1];
          sumB += aw * noteRGB[i][2];
        }
        lutR[ri] = Math.round(((sumR * k + 1) * 0.5) * 255);
        lutG[ri] = Math.round(((sumG * k + 1) * 0.5) * 255);
        lutB[ri] = Math.round(((sumB * k + 1) * 0.5) * 255);
      } else {
        const waveVals = new Array(N);
        for (let i = 0; i < N; i++)
          waveVals[i] = waveFn(2 * Math.PI * sfs[i] * rPhase);
        const gray = Math.round(((superpose(waveVals, amps, superMode) + 1) * 0.5) * 255);
        lutR[ri] = lutG[ri] = lutB[ri] = gray;
      }
    }

    for (let y = 0; y < H; y++) {
      const dy   = y - cy;
      const base = y * W * 4;
      for (let x = 0; x < W; x++) {
        const dx  = x - cx;
        const ri  = Math.min(Math.round(Math.sqrt(dx * dx + dy * dy)), maxRInt - 1);
        const idx = base + x * 4;
        data[idx]     = lutR[ri];
        data[idx + 1] = lutG[ri];
        data[idx + 2] = lutB[ri];
        data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
