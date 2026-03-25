// Visual renderer — three modes:
//   circles  concentric rings, phase varies with radius from canvas centre
//   grid     vertical gratings only (phase varies with x), normalised by W,
//            phase = 0 at canvas centre; N-arm rotational symmetry optional
//   star     angular grating: phase varies with θ around centre
//            n = round(sf) ensures even 360° division for any waveform;
//            n doubles per octave, preserving the pitch→frequency mapping
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

// Cached per-pixel angular index map for star mode.
// Rebuilt only when canvas dimensions change (atan2 is expensive per pixel).
const STAR_BINS = 4096;
let _angMap = null, _angMapW = 0, _angMapH = 0;

function getAngularMap(W, H) {
  if (_angMap && _angMapW === W && _angMapH === H) return _angMap;
  const cx     = W / 2;
  const cy     = H / 2;
  const scale  = STAR_BINS / (2 * Math.PI);
  _angMap  = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    const dy  = y - cy;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const θ = Math.atan2(dy, x - cx);   // [-π, π]
      _angMap[row + x] = Math.floor(((θ + Math.PI) * scale)) % STAR_BINS;
    }
  }
  _angMapW = W;
  _angMapH = H;
  return _angMap;
}

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
  syncSize();
  const { showVisual, sfScale, waveform, superMode, renderMode, hyperbolic, tilt, colorMode,
          gridArms, gridPhase } = opts;
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
    // The canvas is divided into nArms equal wedge sectors. Each sector's
    // grating phase is the projection of (dx,dy) onto that sector's arm
    // direction. This guarantees N-fold rotational symmetry with continuous
    // values at every sector boundary.
    //
    // Hyperbolic mode: warp is applied to the *Euclidean* radius (isotropic,
    // same as circles mode), then used as a scale on the arm projection.
    // phase = 2π · sf · (r_along / r_euc) · 2·atanh(r_euc / R)
    //       = 2π · sf · cos(θ_from_arm) · 2·atanh(r_euc / R)
    // This requires a per-pixel sqrt so a separate inner loop is used.
    const nArms       = Math.max(1, gridArms);
    const armPhase    = gridPhase;
    const R           = Math.min(cx, cy);
    const EPS         = 1e-6;
    const sectorWidth = 2 * Math.PI / nArms;
    const maxR        = Math.ceil(Math.sqrt(cx * cx + cy * cy)) + 1;

    // Pre-compute arm direction vectors
    const armCos = new Float64Array(nArms);
    const armSin = new Float64Array(nArms);
    for (let k = 0; k < nArms; k++) {
      const α  = armPhase + k * sectorWidth;
      armCos[k] = Math.cos(α);
      armSin[k] = Math.sin(α);
    }

    const waveVals = new Array(N);
    const kNorm    = N > 0 ? 1 / N : 1;

    if (hyperbolic) {
      // Euclidean-radius warp scale LUT: hScale[r] = 2·atanh(r/R) / r
      // so that  phase = 2π · sf · r_along · hScale[r_euc]
      // Limit as r→0: 2·atanh(r/R)/r → 2/R
      const hScale = new Float64Array(maxR + 1);
      hScale[0] = 2 / R;
      for (let r = 1; r <= maxR; r++) {
        const rn = r / R;
        hScale[r] = rn < 1 ? 2 * Math.atanh(rn) / r : 0;
      }

      for (let y = 0; y < H; y++) {
        const dy   = y - cy;
        const base = y * W * 4;
        for (let x = 0; x < W; x++) {
          const dx  = x - cx;
          const idx = base + x * 4;
          const r2  = dx * dx + dy * dy;
          if (r2 >= R * R) {
            data[idx] = data[idx + 1] = data[idx + 2] = 128;
            data[idx + 3] = 255;
            continue;
          }
          const rEuc  = Math.round(Math.sqrt(r2));
          const scale = hScale[Math.min(rEuc, maxR)];

          const θ     = Math.atan2(dy, dx);
          const θ_off = ((θ - armPhase + Math.PI / nArms) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
          const k     = Math.min(Math.floor(θ_off / sectorWidth), nArms - 1);
          // r_along · hScale = isotropic hyperbolic phase (unitless, like 2·atanh(r/R))
          const rHyp  = Math.max(0, (dx * armCos[k] + dy * armSin[k]) * scale);

          if (colorMode) {
            let sumR = 0, sumG = 0, sumB = 0;
            for (let i = 0; i < N; i++) {
              const aw = amps[i] * waveFn(2 * Math.PI * sfs[i] * rHyp);
              sumR += aw * noteRGB[i][0];
              sumG += aw * noteRGB[i][1];
              sumB += aw * noteRGB[i][2];
            }
            data[idx]     = Math.round(((sumR * kNorm + 1) * 0.5) * 255);
            data[idx + 1] = Math.round(((sumG * kNorm + 1) * 0.5) * 255);
            data[idx + 2] = Math.round(((sumB * kNorm + 1) * 0.5) * 255);
          } else {
            for (let i = 0; i < N; i++) waveVals[i] = waveFn(2 * Math.PI * sfs[i] * rHyp);
            const gray = Math.round(((superpose(waveVals, amps, superMode) + 1) * 0.5) * 255);
            data[idx] = data[idx + 1] = data[idx + 2] = gray;
          }
          data[idx + 3] = 255;
        }
      }
    } else {
      // Linear: pre-computed per-note LUT indexed by integer r_along (fast path)
      const luts = activeNotes.map((_, i) => {
        const lut = new Float32Array(maxR + 1);
        for (let r = 0; r <= maxR; r++) lut[r] = waveFn(2 * Math.PI * sfs[i] * r / W);
        return lut;
      });

      for (let y = 0; y < H; y++) {
        const dy   = y - cy;
        const base = y * W * 4;
        for (let x = 0; x < W; x++) {
          const dx  = x - cx;
          const idx = base + x * 4;

          const θ     = Math.atan2(dy, dx);
          const θ_off = ((θ - armPhase + Math.PI / nArms) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
          const k     = Math.min(Math.floor(θ_off / sectorWidth), nArms - 1);
          const rIdx  = Math.min(Math.max(0, Math.round(dx * armCos[k] + dy * armSin[k])), maxR);

          if (colorMode) {
            let sumR = 0, sumG = 0, sumB = 0;
            for (let i = 0; i < N; i++) {
              const aw = amps[i] * luts[i][rIdx];
              sumR += aw * noteRGB[i][0];
              sumG += aw * noteRGB[i][1];
              sumB += aw * noteRGB[i][2];
            }
            data[idx]     = Math.round(((sumR * kNorm + 1) * 0.5) * 255);
            data[idx + 1] = Math.round(((sumG * kNorm + 1) * 0.5) * 255);
            data[idx + 2] = Math.round(((sumB * kNorm + 1) * 0.5) * 255);
          } else {
            for (let i = 0; i < N; i++) waveVals[i] = luts[i][rIdx];
            const gray = Math.round(((superpose(waveVals, amps, superMode) + 1) * 0.5) * 255);
            data[idx] = data[idx + 1] = data[idx + 2] = gray;
          }
          data[idx + 3] = 255;
        }
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

  if (renderMode === 'star') {
    // ── Star mode ────────────────────────────────────────────────────────
    // Grating varies with angle θ — equal-width angular wedges radiate from centre.
    // n_i = round(sf_i) is the number of full grating cycles in 360°.
    // Rounding to integer guarantees seamless tiling for any waveform:
    //   waveFn(n·0) = waveFn(n·2π)  iff n ∈ ℤ.
    // n doubles per octave (same ratio as sf), preserving the pitch mapping.
    // The cached angular map avoids per-pixel atan2 in the render loop.
    const R      = Math.min(cx, cy);
    const R2     = R * R;
    const angMap = getAngularMap(W, H);
    const kNorm  = N > 0 ? 1 / N : 1;

    // Per-note angular LUT: lut[k] = waveFn(n · 2π · k / STAR_BINS)
    const angLuts = activeNotes.map((_, i) => {
      const n   = Math.max(1, Math.round(sfs[i]));
      const lut = new Float32Array(STAR_BINS);
      for (let k = 0; k < STAR_BINS; k++) {
        lut[k] = waveFn(n * 2 * Math.PI * k / STAR_BINS);
      }
      return lut;
    });

    const waveVals = new Array(N);

    for (let y = 0; y < H; y++) {
      const dy      = y - cy;
      const base    = y * W * 4;
      const mapRow  = y * W;
      for (let x = 0; x < W; x++) {
        const dx  = x - cx;
        const idx = base + x * 4;

        if (hyperbolic && (dx * dx + dy * dy) >= R2) {
          data[idx] = data[idx + 1] = data[idx + 2] = 128;
          data[idx + 3] = 255;
          continue;
        }

        const k = angMap[mapRow + x];

        if (colorMode) {
          let sumR = 0, sumG = 0, sumB = 0;
          for (let i = 0; i < N; i++) {
            const aw = amps[i] * angLuts[i][k];
            sumR += aw * noteRGB[i][0];
            sumG += aw * noteRGB[i][1];
            sumB += aw * noteRGB[i][2];
          }
          data[idx]     = Math.round(((sumR * kNorm + 1) * 0.5) * 255);
          data[idx + 1] = Math.round(((sumG * kNorm + 1) * 0.5) * 255);
          data[idx + 2] = Math.round(((sumB * kNorm + 1) * 0.5) * 255);
        } else {
          for (let i = 0; i < N; i++) waveVals[i] = angLuts[i][k];
          const gray = Math.round(((superpose(waveVals, amps, superMode) + 1) * 0.5) * 255);
          data[idx] = data[idx + 1] = data[idx + 2] = gray;
        }
        data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
