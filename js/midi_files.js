// MIDI file registry and binary generators

export const MIDI_FILES = [
  { name: 'C Major Scale (test)',      type: 'generated', generator: 'scale'    },
  { name: 'I–IV–V–I Chords (test)',   type: 'generated', generator: 'chords'   },
  { name: 'Chromatic Scale (test)',    type: 'generated', generator: 'chromatic' },
  { name: 'Drone + Melody (test)',     type: 'generated', generator: 'drone'    },
];

// ── Binary MIDI helpers ───────────────────────────────────────────────────────

function varLen(n) {
  if (n === 0) return [0];
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0x7F); n >>= 7; }
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  return bytes;
}

function buildMidi(events, tpq = 480) {
  const trackBytes = [];
  for (const ev of events) {
    trackBytes.push(...varLen(ev.delta), ...ev.data);
  }
  trackBytes.push(0x00, 0xFF, 0x2F, 0x00); // end of track

  const buf = new ArrayBuffer(14 + 8 + trackBytes.length);
  const v = new DataView(buf);
  let p = 0;

  // MThd
  [0x4D,0x54,0x68,0x64].forEach(b => v.setUint8(p++, b));
  v.setUint32(p, 6);    p += 4;
  v.setUint16(p, 0);    p += 2; // format 0
  v.setUint16(p, 1);    p += 2; // 1 track
  v.setUint16(p, tpq);  p += 2;

  // MTrk
  [0x4D,0x54,0x72,0x6B].forEach(b => v.setUint8(p++, b));
  v.setUint32(p, trackBytes.length); p += 4;
  trackBytes.forEach(b => v.setUint8(p++, b));

  return buf;
}

function tempoEvent(bpm) {
  const us = Math.round(60_000_000 / bpm);
  return { delta: 0, data: [0xFF, 0x51, 0x03, (us >> 16) & 0xFF, (us >> 8) & 0xFF, us & 0xFF] };
}

function keyEvent(sharps, scale) {
  // scale: 0 = major, 1 = minor
  return { delta: 0, data: [0xFF, 0x59, 0x02, sharps & 0xFF, scale] };
}

function noteOn(note, vel, delta = 0)  { return { delta, data: [0x90, note, vel] }; }
function noteOff(note, delta = 0)      { return { delta, data: [0x80, note, 0]   }; }

// ── Generators ────────────────────────────────────────────────────────────────

function generateScale() {
  const tpq = 480;
  const notes = [60, 62, 64, 65, 67, 69, 71, 72]; // C4 → C5
  const events = [tempoEvent(120), keyEvent(0, 0)];
  for (const n of notes) {
    events.push(noteOn(n, 100));
    events.push(noteOff(n, tpq));
  }
  return buildMidi(events, tpq);
}

function generateChords() {
  const tpq = 480;
  const barLen = tpq * 4;
  // I  IV  V  I  in C major
  const chords = [
    [60, 64, 67],
    [65, 69, 72],
    [67, 71, 74],
    [60, 64, 67],
  ];
  const events = [tempoEvent(80), keyEvent(0, 0)];
  for (const chord of chords) {
    chord.forEach(n => events.push(noteOn(n, 90)));
    events.push(noteOff(chord[0], barLen));
    chord.slice(1).forEach(n => events.push(noteOff(n)));
  }
  return buildMidi(events, tpq);
}

function generateChromatic() {
  const tpq = 480;
  const notes = Array.from({length: 13}, (_, i) => 60 + i); // C4..C5
  const events = [tempoEvent(100), keyEvent(0, 0)];
  for (const n of notes) {
    events.push(noteOn(n, 90));
    events.push(noteOff(n, Math.round(tpq * 0.75)));
  }
  return buildMidi(events, tpq);
}

function generateDrone() {
  const tpq = 480;
  // Drone on C3 (48) + melody on top
  const melody = [64, 67, 69, 71, 72, 71, 69, 67, 64];
  const droneNote = 48;
  const totalBeats = melody.length;
  const events = [tempoEvent(90), keyEvent(0, 0)];

  // Drone note on
  events.push(noteOn(droneNote, 60));

  // Melody
  for (const n of melody) {
    events.push(noteOn(n, 100));
    events.push(noteOff(n, tpq));
  }

  // Drone note off (delta from last note off)
  events.push(noteOff(droneNote));

  return buildMidi(events, tpq);
}

export function generateMidi(type) {
  switch (type) {
    case 'scale':      return generateScale();
    case 'chords':     return generateChords();
    case 'chromatic':  return generateChromatic();
    case 'drone':      return generateDrone();
    default: throw new Error(`Unknown generator: ${type}`);
  }
}

export async function loadMidiFile(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.arrayBuffer();
}
