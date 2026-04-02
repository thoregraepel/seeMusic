// color_dial.js — circular pitch-class → colour mapping dial.
//
// A fixed conic-gradient colour wheel sits in the centre (red at 12 o'clock,
// going clockwise through orange → yellow → green → cyan → blue → violet).
// The outer ring of pitch-class labels can be dragged to rotate, changing
// which hue each note maps to.  The ring snaps to 30° increments so each
// label always sits exactly over a colour band.
//
// Counterclockwise mode reverses the label order on the ring so that
// ascending pitch still aligns with the correct colour but goes the other
// way around the wheel.  In both modes every label sits precisely over the
// colour it will produce in the visualisation.
//
// Usage:
//   const dial = initDial(mountEl, ({ offset, direction }) => { … });

const NOTES   = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);   // C D E F G A B

const R_WHEEL    = 52;   // colour-wheel outer radius (SVG units, origin = centre)
const R_TICK_IN  = 56;   // inner end of tick mark
const R_TICK_OUT = 61;   // outer end of tick mark
const R_LABEL    = 70;   // note-name radial position
const R_TIP      = 54;   // pointer triangle tip

// Angle (radians, SVG convention) for ring slot i given direction.
// direction=+1: C at top, ascending CW.  direction=-1: C at top, ascending CCW.
function slotRad(i, direction) {
  const pos = direction === 1 ? i : (12 - i) % 12;
  return (pos * 30 - 90) * (Math.PI / 180);
}

export function initDial(mount, onChange) {
  let _offset    = 0;      // snapped hue offset, degrees [0, 360)
  let _rawOffset = 0;      // continuous accumulator for smooth dragging
  let _direction = 1;      // +1 CW | -1 CCW
  let _dragging  = false;
  let _lastAngle = 0;

  // ── Build DOM ──────────────────────────────────────────────────────────────
  mount.innerHTML = `
    <div class="cdial-wrap">
      <div class="cdial-area">
        <div class="cdial-wheel"></div>
        <svg class="cdial-svg" viewBox="-80 -80 160 160" aria-hidden="true">
          <circle r="3" fill="#333" stroke="#555" stroke-width="1"/>
          <polygon class="cdial-pointer"
            points="0,${-(R_TIP+11)} -4.5,${-(R_TIP-1)} 4.5,${-(R_TIP-1)}"/>
          <g class="cdial-ring">
            ${NOTES.map((name, i) => {
              const nat = NATURAL.has(i);
              return `
                <line class="cdial-tick${nat ? '' : ' cdial-tick-sharp'}"
                  x1="0" y1="0" x2="0" y2="0"/>
                <text class="cdial-label${nat ? ' cdial-nat' : ''}"
                  x="0" y="0" text-anchor="middle" dominant-baseline="central"
                  >${name}</text>`;
            }).join('')}
          </g>
        </svg>
      </div>
      <label class="cdial-dir">
        <input type="checkbox" class="cdial-dir-chk">
        <span>↺ Counterclockwise</span>
      </label>
      <div class="cdial-hint">Drag to shift · snaps to semitones</div>
    </div>`;

  const area   = mount.querySelector('.cdial-area');
  const ring   = mount.querySelector('.cdial-ring');
  const dirChk = mount.querySelector('.cdial-dir-chk');
  const lines  = Array.from(ring.querySelectorAll('line'));
  const texts  = Array.from(ring.querySelectorAll('text'));

  // ── Position ring elements based on current direction ──────────────────────
  function layoutRing() {
    NOTES.forEach((_, i) => {
      const rad = slotRad(i, _direction);
      const cos = Math.cos(rad), sin = Math.sin(rad);
      lines[i].setAttribute('x1', (cos * R_TICK_IN ).toFixed(2));
      lines[i].setAttribute('y1', (sin * R_TICK_IN ).toFixed(2));
      lines[i].setAttribute('x2', (cos * R_TICK_OUT).toFixed(2));
      lines[i].setAttribute('y2', (sin * R_TICK_OUT).toFixed(2));
      texts[i].setAttribute('x',  (cos * R_LABEL).toFixed(2));
      texts[i].setAttribute('y',  (sin * R_LABEL).toFixed(2));
    });
  }

  function applyRing() {
    ring.setAttribute('transform', `rotate(${_offset})`);
  }

  function snap(raw) {
    return ((Math.round(raw / 30) * 30) % 360 + 360) % 360;
  }

  function emit() { onChange({ offset: _offset, direction: _direction }); }

  // ── Drag ──────────────────────────────────────────────────────────────────
  function ptrAngle(e) {
    const p = e.touches ? e.touches[0] : e;
    const r = area.getBoundingClientRect();
    return Math.atan2(p.clientY - (r.top  + r.height / 2),
                      p.clientX - (r.left + r.width  / 2)) * 180 / Math.PI;
  }

  function onStart(e) {
    _dragging = true;
    _lastAngle = ptrAngle(e);
    e.preventDefault();
  }
  function onMove(e) {
    if (!_dragging) return;
    const a = ptrAngle(e);
    let d = a - _lastAngle;
    if (d >  180) d -= 360;
    if (d < -180) d += 360;
    _lastAngle  = a;
    _rawOffset += d;
    const snapped = snap(_rawOffset);
    if (snapped !== _offset) {
      _offset = snapped;
      applyRing();
      emit();
    }
    if (e.cancelable) e.preventDefault();
  }
  function onEnd() { _dragging = false; }

  area.addEventListener('mousedown',  onStart);
  area.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('mousemove',  onMove);
  window.addEventListener('touchmove',  onMove, { passive: false });
  window.addEventListener('mouseup',   onEnd);
  window.addEventListener('touchend',  onEnd);

  // ── Direction toggle ───────────────────────────────────────────────────────
  dirChk.addEventListener('change', () => {
    _direction = dirChk.checked ? -1 : 1;
    layoutRing();
    emit();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  layoutRing();
  applyRing();

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    setOffset(v) {
      _offset = _rawOffset = snap(v);
      applyRing();
    },
    setDirection(d) {
      _direction = d;
      dirChk.checked = d === -1;
      layoutRing();
    },
  };
}

// Shared utility: midi note → hue in degrees.
export function pitchHue(midi, offset, direction) {
  return ((direction * (midi % 12) * 30) + offset + 3600) % 360;
}
