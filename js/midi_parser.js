// Wraps @tonejs/midi (window.Midi) into a clean internal format.
// Note: @tonejs/midi normalises velocity to 0-1.

// Maps MIDI key signature (sharps count, -7..+7) + scale to tonic MIDI note in octave 4.
const KEY_MAP = {
  major: { 0:60, 1:67, 2:62, 3:69, 4:64, 5:71, 6:66, 7:61, '-1':65, '-2':70, '-3':63, '-4':68, '-5':61, '-6':66, '-7':59 },
  minor: { 0:69, 1:64, 2:71, 3:66, 4:61, 5:68, 6:63, 7:70, '-1':62, '-2':67, '-3':60, '-4':65, '-5':70, '-6':63, '-7':68 },
};

const KEY_NAMES = {
  major: { 0:'C', 1:'G', 2:'D', 3:'A', 4:'E', 5:'B', 6:'F♯', 7:'C♯', '-1':'F', '-2':'B♭', '-3':'E♭', '-4':'A♭', '-5':'D♭', '-6':'G♭', '-7':'C♭' },
  minor: { 0:'Am', 1:'Em', 2:'Bm', 3:'F♯m', 4:'C♯m', 5:'G♯m', 6:'D♯m', 7:'A♯m', '-1':'Dm', '-2':'Gm', '-3':'Cm', '-4':'Fm', '-5':'B♭m', '-6':'E♭m', '-7':'A♭m' },
};

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{ allNotes, tonicMidi, duration, bpm, keyName }}
 */
export function parseMidi(arrayBuffer) {
  const midi = new Midi(arrayBuffer); // window.Midi from CDN

  const allNotes = midi.tracks
    .flatMap(t => t.notes)
    .map(n => ({
      midi:     n.midi,
      time:     n.time,
      duration: n.duration,
      velocity: n.velocity, // 0–1
    }))
    .sort((a, b) => a.time - b.time);

  let tonicMidi = 60;
  let keyName   = 'C major (default)';

  const keySig = midi.header.keySignatures[0];
  if (keySig) {
    const scale = keySig.scale ?? 'major';
    const key   = String(keySig.key ?? 0);
    const map   = KEY_MAP[scale] ?? KEY_MAP.major;
    const names = KEY_NAMES[scale] ?? KEY_NAMES.major;
    tonicMidi   = map[key] ?? 60;
    keyName     = (names[key] ?? 'C') + (scale === 'major' ? ' major' : ' minor');
  }

  const duration = midi.duration || 1;
  const bpm      = midi.header.tempos[0]?.bpm ?? 120;

  return { allNotes, tonicMidi, duration, bpm, keyName };
}
