// Piano keyboard visualisation with per-note energy bar plot above the keys.
//
// Canvas is split vertically:
//   top BAR_FRAC  → energy bar plot (one bar per MIDI note, aligned to keys)
//   bottom rest   → piano keyboard
//
// Three visual states on keyboard:
//   Active (in-range, currently playing) — bright pitch colour / blue
//   Decaying (recently played)           — amber glow, fades over DECAY_MS
//   Idle in-range                        — light grey / dark grey
//   Out-of-range                         — dimmed (still shows decay trail)

const MIDI_MIN  = 21;   // A0
const MIDI_MAX  = 108;  // C8
const DECAY_MS  = 1500;
const BAR_FRAC  = 0.42; // fraction of total height used for the bar plot

const WHITE_OFFSETS = new Set([0, 2, 4, 5, 7, 9, 11]);
const isWhite = midi => WHITE_OFFSETS.has(midi % 12);

let canvas, ctx;
let _onRangeChange = null;
let _isDragging    = false;
let _layout        = null;
let _lastLow = 24, _lastHigh = 96;

// midi → timestamp (ms) of last frame it was active (any note, before range filter)
const _lastSeen = new Map();

// ── Init ──────────────────────────────────────────────────────────────────────

export function init(canvasEl, onRangeChange) {
  canvas = canvasEl;
  ctx    = canvas.getContext('2d');
  _onRangeChange = onRangeChange;

  canvas.addEventListener('mousedown',  e => { _isDragging = true;  handlePtr(e); });
  canvas.addEventListener('mousemove',  e => { if (_isDragging) handlePtr(e); });
  canvas.addEventListener('mouseup',    () => { _isDragging = false; });
  canvas.addEventListener('mouseleave', () => { _isDragging = false; });
  canvas.addEventListener('touchstart', e => { e.preventDefault(); _isDragging = true; handlePtr(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); handlePtr(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchend',   () => { _isDragging = false; });

  const ro = new ResizeObserver(() => { _layout = null; });
  ro.observe(canvas.parentElement);
}

// ── Public draw call ──────────────────────────────────────────────────────────

// allNotes    — every detected/played note (full range, before filtering)
//               MIDI mode: [{midi, velocity}]   Audio mode: [{midi, db}] (raw dBFS)
// activeNotes — range-filtered subset driving the visual engine
// threshold   — (audio/mic only) base threshold dBFS; undefined in MIDI mode
// thresholdTilt — dB/octave slope applied to threshold
export function draw(allNotes, activeNotes, lowMidi, highMidi, colorMode,
                     threshold = undefined, thresholdTilt = 0) {
  syncSize();
  if (!_layout) _layout = buildLayout();
  _lastLow  = lowMidi;
  _lastHigh = highMidi;

  const now = performance.now();
  for (const n of allNotes)            _lastSeen.set(n.midi, now);
  for (const [midi, t] of _lastSeen)   if (now - t > DECAY_MS) _lastSeen.delete(midi);

  render(allNotes, activeNotes, lowMidi, highMidi, colorMode, now, threshold, thresholdTilt);
}

// ── Resize ────────────────────────────────────────────────────────────────────

function syncSize() {
  const p = canvas.parentElement;
  const W = Math.floor(p.clientWidth)  || 800;
  const H = Math.floor(p.clientHeight) || 130;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width  = W;
    canvas.height = H;
    _layout = null;
  }
}

// ── Layout ────────────────────────────────────────────────────────────────────

function buildLayout() {
  const W    = canvas.width;
  const H    = canvas.height;
  const barH = Math.floor(H * BAR_FRAC);
  const keyY = barH + 1; // +1 for separator line
  const keyH = H - keyY;

  let totalWhite = 0;
  for (let m = MIDI_MIN; m <= MIDI_MAX; m++) if (isWhite(m)) totalWhite++;
  const wkW = W / totalWhite;

  const whiteX = new Map();
  let wi = 0;
  for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
    if (isWhite(m)) { whiteX.set(m, wi * wkW); wi++; }
  }

  const keys = [];
  for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
    if (isWhite(m)) {
      keys.push({ midi: m, x: whiteX.get(m), y: keyY, w: wkW - 1, h: keyH, white: true });
    } else {
      let prev = m - 1; while (prev > MIDI_MIN && !isWhite(prev)) prev--;
      let next = m + 1; while (next < MIDI_MAX && !isWhite(next)) next++;
      const x1 = (whiteX.get(prev) ?? 0) + wkW;
      const x2 =  whiteX.get(next) ?? W;
      const bw  = wkW * 0.6;
      keys.push({ midi: m, x: (x1 + x2) / 2 - bw / 2, y: keyY, w: bw, h: keyH * 0.62, white: false });
    }
  }

  return { keys, wkW, barH, keyY, keyH };
}

// ── Pointer → MIDI (keyboard area only) ──────────────────────────────────────

function xToMidi(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (canvas.width  / rect.width);
  const y = (clientY - rect.top)  * (canvas.height / rect.height);
  if (y < _layout.keyY) return null; // click was in bar area
  const { keys } = _layout;
  for (const k of keys) if (!k.white && x >= k.x && x < k.x + k.w) return k.midi;
  for (const k of keys) if ( k.white && x >= k.x && x < k.x + k.w) return k.midi;
  return null;
}

function handlePtr(e) {
  if (!_layout || !_onRangeChange) return;
  const midi = xToMidi(e.clientX, e.clientY);
  if (midi === null) return;
  const mid = (_lastLow + _lastHigh) / 2;
  if (midi <= mid) _onRangeChange(Math.min(midi, _lastHigh - 1), _lastHigh);
  else             _onRangeChange(_lastLow, Math.max(midi, _lastLow + 1));
}

// ── Render ────────────────────────────────────────────────────────────────────

const DB_MIN = -90;  // dBFS floor for absolute bar display

function render(allNotes, activeNotes, lowMidi, highMidi, colorMode, now, threshold, thresholdTilt) {
  const { keys, barH, keyY } = _layout;
  const W = canvas.width;
  const H = canvas.height;

  // Detect audio mode: allNotes entries have a `db` property instead of `velocity`
  const audioMode = threshold !== undefined;
  const allMap    = audioMode
    ? new Map(allNotes.map(n => [n.midi, n.db]))
    : new Map(allNotes.map(n => [n.midi, n.velocity]));
  const activeMap = new Map(activeNotes.map(n => [n.midi, n.velocity]));

  ctx.clearRect(0, 0, W, H);

  // ── Bar plot ──────────────────────────────────────────────────────────────
  for (const k of keys) {
    const val     = allMap.get(k.midi);
    const inRange = k.midi >= lowMidi && k.midi <= highMidi;
    const pc      = k.midi % 12;

    let bh = 0;
    if (audioMode) {
      if (val !== undefined && val > DB_MIN) {
        bh = Math.max(1, ((val - DB_MIN) / -DB_MIN) * (barH - 2));
      }
    } else {
      if (val > 0) bh = Math.max(1, val * (barH - 2));
    }

    if (bh > 0) {
      const by = barH - bh;
      ctx.fillStyle = colorMode
        ? `hsl(${pc * 30},100%,${inRange ? 60 : 35}%)`
        : (inRange ? '#4a9eff' : '#2a5080');
      ctx.fillRect(k.x, by, k.w, bh);
    }
  }

  // ── Threshold line (audio/mic mode) ──────────────────────────────────────
  if (audioMode) {
    // Threshold is linear in MIDI number, so a straight line across the canvas suffices
    const threshAt = midi => threshold + thresholdTilt * (midi - 60) / 12;
    const dbToY    = db => (barH - 2) * (1 - Math.max(0, Math.min(1, (db - DB_MIN) / -DB_MIN)));
    const yLeft    = dbToY(threshAt(MIDI_MIN));
    const yRight   = dbToY(threshAt(MIDI_MAX));
    ctx.save();
    ctx.strokeStyle = '#e0a020';
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(0, yLeft);
    ctx.lineTo(W, yRight);
    ctx.stroke();
    ctx.restore();
  }

  // Separator line between bars and keyboard
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, keyY - 1); ctx.lineTo(W, keyY - 1);
  ctx.stroke();

  // ── White keys ───────────────────────────────────────────────────────────
  for (const k of keys) {
    if (!k.white) continue;
    const inRange = k.midi >= lowMidi && k.midi <= highMidi;
    const active  = activeMap.has(k.midi);
    ctx.fillStyle = active
      ? (colorMode ? `hsl(${k.midi % 12 * 30},100%,65%)` : '#4a9eff')
      : (inRange ? '#ccc' : '#777');
    ctx.fillRect(k.x, k.y, k.w, k.h);

    if (!active) {
      const decay = getDecay(k.midi, now);
      if (decay > 0) {
        ctx.globalAlpha = decay * 0.75;
        ctx.fillStyle = '#e8a020';
        ctx.fillRect(k.x, k.y, k.w, k.h);
        ctx.globalAlpha = 1;
      }
    }

    ctx.strokeStyle = '#444';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(k.x, k.y, k.w, k.h);
  }

  // ── Black keys ───────────────────────────────────────────────────────────
  for (const k of keys) {
    if (k.white) continue;
    const inRange = k.midi >= lowMidi && k.midi <= highMidi;
    const active  = activeMap.has(k.midi);
    ctx.fillStyle = active
      ? (colorMode ? `hsl(${k.midi % 12 * 30},100%,40%)` : '#2268b0')
      : (inRange ? '#1a1a1a' : '#444');
    ctx.fillRect(k.x, k.y, k.w, k.h);

    if (!active) {
      const decay = getDecay(k.midi, now);
      if (decay > 0) {
        ctx.globalAlpha = decay * 0.7;
        ctx.fillStyle = '#c07010';
        ctx.fillRect(k.x, k.y, k.w, k.h);
        ctx.globalAlpha = 1;
      }
    }

    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(k.x, k.y, k.w, k.h);
  }

  // ── C labels ─────────────────────────────────────────────────────────────
  const fontSize = Math.max(7, Math.min(11, _layout.wkW * 0.55));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const k of keys) {
    if (!k.white || k.midi % 12 !== 0) continue;
    const octave  = Math.floor(k.midi / 12 - 1);
    const inRange = k.midi >= lowMidi && k.midi <= highMidi;
    const active  = activeMap.has(k.midi);
    ctx.fillStyle = active ? 'rgba(0,0,0,0.6)' : (inRange ? '#666' : '#999');
    ctx.fillText(`C${octave}`, k.x + k.w / 2, k.y + k.h - 2);
  }

  // ── Range handles ─────────────────────────────────────────────────────────
  drawHandle(lowMidi,  true);
  drawHandle(highMidi, false);
}

function getDecay(midi, now) {
  const t = _lastSeen.get(midi);
  if (t === undefined) return 0;
  const age = now - t;
  if (age >= DECAY_MS) return 0;
  return Math.pow(1 - age / DECAY_MS, 1.5);
}

function drawHandle(midi, isLow) {
  const k = _layout.keys.find(k => k.midi === midi);
  if (!k) return;
  const s = Math.min(_layout.keyH * 0.28, 13);
  const x = isLow ? k.x : k.x + k.w;

  ctx.fillStyle = '#e0a020';
  ctx.beginPath();
  if (isLow) {
    ctx.moveTo(x,     k.y);
    ctx.lineTo(x + s, k.y);
    ctx.lineTo(x,     k.y + s * 1.3);
  } else {
    ctx.moveTo(x,     k.y);
    ctx.lineTo(x - s, k.y);
    ctx.lineTo(x,     k.y + s * 1.3);
  }
  ctx.closePath();
  ctx.fill();
}
