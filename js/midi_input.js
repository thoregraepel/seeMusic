// Web MIDI input — tracks currently held notes from any connected MIDI device.
// Calls onNotesChange([{midi, velocity}, ...]) whenever the held set changes.

const heldNotes = new Map(); // midi number → {midi, velocity}
let onNotesChange = null;
let midiAccess = null;

export async function initMidiInput(callback) {
  onNotesChange = callback;
  if (!navigator.requestMIDIAccess) {
    throw new Error('Web MIDI API not supported. Please use Chrome or Edge.');
  }
  midiAccess = await navigator.requestMIDIAccess();
  attachInputs();
  midiAccess.onstatechange = attachInputs;
  return getInputNames();
}

function attachInputs() {
  for (const input of midiAccess.inputs.values()) {
    input.onmidimessage = handleMessage;
  }
}

function handleMessage(msg) {
  const [status, note, velocity] = msg.data;
  const type = status & 0xF0;
  if (type === 0x90 && velocity > 0) {
    heldNotes.set(note, { midi: note, velocity: velocity / 127 });
  } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
    heldNotes.delete(note);
  }
  onNotesChange?.([...heldNotes.values()]);
}

export function getLiveNotes() {
  return [...heldNotes.values()];
}

export function getInputNames() {
  if (!midiAccess) return [];
  return [...midiAccess.inputs.values()].map(i => i.name);
}

export function clearNotes() {
  heldNotes.clear();
  onNotesChange?.([]);
}
