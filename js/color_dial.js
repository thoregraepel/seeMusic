// color_dial.js — circular pitch-class → colour mapping dial.
//
// A fixed conic-gradient colour wheel sits in the centre.  The outer ring of
// pitch-class labels can be dragged to rotate, changing which hue each note
// maps to.  A direction toggle reverses the sequence so ascending pitch goes
// counterclockwise around the wheel.
//
// Usage:
//   const dial = initDial(mountEl, ({ offset, direction }) => { … });
//   dial.setOffset(0);       // degrees [0, 360)
//   dial.setDirection(1);    // +1 CW (default) | -1 CCW

const NOTES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]); // C D E F G A B

const R_WHEEL   = 52;   // colour-wheel outer radius (SVG units, origin = centre)
const R_TICK_IN = 56;   // inner end of tick mark
const R_TICK_OUT= 61;   // outer end of tick mark
const R_LABEL   = 70;   // note-name radial position
const R_TIP     = 54;   // pointer triangle tip (just inside wheel edge)

export function initDial(mount, onChange) {
  let _offset    = 0;   // degrees [0, 360)
  let _direction = 1;   // +1 or -1
  let _dragging  = false;
  let _lastAngle = 0;

  // ── Build DOM ──────────────────────────────────────────────────────────────
  mount.innerHTML = `
    <div class="cdial-wrap">
      <div class="cdial-area">
        <div class="cdial-wheel"></div>
        <svg class="cdial-svg" viewBox="-80 -80 160 160" aria-hidden="true">
          <!-- Fixed centre dot -->
          <circle r="3" fill="#333" stroke="#555" stroke-width="1"/>
          <!-- Fixed pointer: upward triangle pointing at the wheel edge -->
          <polygon class="cdial-pointer"
            points="0,${-(R_TIP+11)} -4.5,${-(R_TIP-1)} 4.5,${-(R_TIP-1)}"/>
          <!-- Rotating ring: ticks + labels -->
          <g class="cdial-ring">
            ${NOTES.map((name, i) => {
              const rad  = (i * 30 - 90) * (Math.PI / 180);
              const cos  = Math.cos(rad), sin = Math.sin(rad);
              const nat  = NATURAL.has(i);
              return `
                <line class="cdial-tick${nat ? '' : ' cdial-tick-sharp'}"
                  x1="${(cos * R_TICK_IN ).toFixed(2)}" y1="${(sin * R_TICK_IN ).toFixed(2)}"
                  x2="${(cos * R_TICK_OUT).toFixed(2)}" y2="${(sin * R_TICK_OUT).toFixed(2)}"/>
                <text class="cdial-label${nat ? ' cdial-nat' : ''}"
                  x="${(cos * R_LABEL).toFixed(2)}" y="${(sin * R_LABEL).toFixed(2)}"
                  text-anchor="middle" dominant-baseline="central">${name}</text>`;
            }).join('')}
          </g>
        </svg>
      </div>
      <label class="cdial-dir">
        <input type="checkbox" class="cdial-dir-chk">
        <span>↺ Counterclockwise</span>
      </label>
      <div class="cdial-hint">Drag wheel to shift colour mapping</div>
    </div>`;

  const area   = mount.querySelector('.cdial-area');
  const ring   = mount.querySelector('.cdial-ring');
  const dirChk = mount.querySelector('.cdial-dir-chk');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function ptrAngle(e) {
    const p = e.touches ? e.touches[0] : e;
    const r = area.getBoundingClientRect();
    return Math.atan2(p.clientY - (r.top + r.height / 2),
                      p.clientX - (r.left  + r.width  / 2)) * 180 / Math.PI;
  }

  function applyRing() {
    ring.setAttribute('transform', `rotate(${_offset})`);
  }

  function emit() { onChange({ offset: _offset, direction: _direction }); }

  // ── Drag ──────────────────────────────────────────────────────────────────
  area.addEventListener('mousedown', e => {
    _dragging = true; _lastAngle = ptrAngle(e); e.preventDefault();
  });
  area.addEventListener('touchstart', e => {
    _dragging = true; _lastAngle = ptrAngle(e); e.preventDefault();
  }, { passive: false });

  window.addEventListener('mousemove', e => {
    if (!_dragging) return;
    let d = ptrAngle(e) - _lastAngle;
    if (d >  180) d -= 360;
    if (d < -180) d += 360;
    _lastAngle += d;
    _offset = ((_offset + d) % 360 + 360) % 360;
    applyRing();
    emit();
  });
  window.addEventListener('touchmove', e => {
    if (!_dragging) return;
    let d = ptrAngle(e) - _lastAngle;
    if (d >  180) d -= 360;
    if (d < -180) d += 360;
    _lastAngle += d;
    _offset = ((_offset + d) % 360 + 360) % 360;
    applyRing();
    emit();
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('mouseup',  () => { _dragging = false; });
  window.addEventListener('touchend', () => { _dragging = false; });

  // ── Direction toggle ───────────────────────────────────────────────────────
  dirChk.addEventListener('change', () => {
    _direction = dirChk.checked ? -1 : 1;
    emit();
  });

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    setOffset(v)    { _offset    = ((v % 360) + 360) % 360; applyRing(); },
    setDirection(d) { _direction = d; dirChk.checked = d === -1; },
  };
}

// Shared utility: midi → hue in degrees, respecting offset and direction.
export function pitchHue(midi, offset, direction) {
  return ((direction * (midi % 12) * 30) + offset % 360 + 3600) % 360;
}
