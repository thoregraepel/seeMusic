// QWERTY piano keyboard — standard DAW layout
//
// Lower row (base octave):
//   Z  S  X  D  C  V  G  B  H  N  J  M
//   C  C# D  D# E  F  F# G  G# A  A# B
//
// Upper row (base octave + 1):
//   Q  2  W  3  E  R  5  T  6  Y  7  U  I
//   C  C# D  D# E  F  F# G  G# A  A# B  C
//
// [  = octave down     ]  = octave up

const KEY_MAP = {
  KeyZ: 0,  KeyS: 1,  KeyX: 2,  KeyD: 3,  KeyC: 4,
  KeyV: 5,  KeyG: 6,  KeyB: 7,  KeyH: 8,  KeyN: 9,  KeyJ: 10, KeyM: 11,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16,
  KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22,
  KeyU: 23, KeyI: 24,
};

let baseOctave = 4;
let enabled    = false;
let pressed    = new Map();  // e.code → midi note number
let _onNoteOn  = null;
let _onNoteOff = null;
let _onOctave  = null;

function toMidi(semitone) {
  return 12 * (baseOctave + 1) + semitone;
}

function onKeyDown(e) {
  if (!enabled) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.repeat) return;

  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    // Release held notes, shift octave, re-trigger
    for (const [code, note] of pressed) { _onNoteOff?.(note); }
    baseOctave = e.code === 'BracketLeft'
      ? Math.max(0, baseOctave - 1)
      : Math.min(8, baseOctave + 1);
    for (const [code] of pressed) {
      const note = toMidi(KEY_MAP[code]);
      pressed.set(code, note);
      _onNoteOn?.(note, 0.8);
    }
    _onOctave?.(baseOctave);
    return;
  }

  const semi = KEY_MAP[e.code];
  if (semi === undefined || pressed.has(e.code)) return;
  e.preventDefault();
  const note = toMidi(semi);
  pressed.set(e.code, note);
  _onNoteOn?.(note, 0.8);
}

function onKeyUp(e) {
  if (!enabled) return;
  const note = pressed.get(e.code);
  if (note === undefined) return;
  pressed.delete(e.code);
  _onNoteOff?.(note);
}

export function init({ noteOn, noteOff, octaveChange }) {
  _onNoteOn  = noteOn;
  _onNoteOff = noteOff;
  _onOctave  = octaveChange;
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   onKeyUp);
}

export function setEnabled(on) {
  enabled = on;
  if (!on) {
    for (const note of pressed.values()) _onNoteOff?.(note);
    pressed.clear();
  }
}

export function isEnabled()     { return enabled; }
export function getBaseOctave() { return baseOctave; }
