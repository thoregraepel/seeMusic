// basic_pitch.js — runs Basic Pitch on the main thread (no Web Worker).
//
// The bundle (~1.1 MB) is loaded lazily on first transcription. TF.js is
// forced onto the CPU backend before any model work, which avoids the
// WebGL/document availability checks that cause hangs in some environments.
//
// Usage:
//   const t = new BasicPitchTranscriber();
//   const notes = await t.transcribe(audioBuffer, fraction => console.log(fraction));
//   // notes: [{midi, velocity, time, duration}]

const MODEL_URL = 'https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json';

// Load the IIFE bundle once and cache the promise.
let _bundleReady = null;
function loadBundle() {
  if (_bundleReady) return _bundleReady;
  _bundleReady = new Promise((resolve, reject) => {
    if (window.BasicPitchLib) { resolve(); return; }
    const script    = document.createElement('script');
    script.src      = 'js/basic_pitch_bundle.js';
    script.onload   = resolve;
    script.onerror  = () => reject(new Error('Failed to load basic_pitch_bundle.js'));
    document.head.appendChild(script);
  });
  return _bundleReady;
}

export class BasicPitchTranscriber {
  constructor() {
    this._cancelled = false;
  }

  // Resample an AudioBuffer to 22050 Hz mono (what Basic Pitch expects).
  async _prepare(audioBuffer) {
    const TARGET_SR = 22050;
    if (audioBuffer.sampleRate === TARGET_SR && audioBuffer.numberOfChannels === 1) {
      return audioBuffer;
    }
    const length  = Math.ceil(audioBuffer.duration * TARGET_SR);
    const offline = new OfflineAudioContext(1, length, TARGET_SR);
    const src     = offline.createBufferSource();
    src.buffer    = audioBuffer;
    src.connect(offline.destination);
    src.start(0);
    return offline.startRendering();
  }

  async transcribe(audioBuffer, onProgress = () => {}) {
    this._cancelled = false;

    await loadBundle();

    const { BasicPitch, ready, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly }
      = window.BasicPitchLib;

    // Wait for the CPU backend to finish initialising (set in the bundle's entry.js).
    await ready;

    const prepared = await this._prepare(audioBuffer);

    if (this._cancelled) throw new Error('Cancelled');

    const frames   = [];
    const onsets   = [];
    const contours = [];

    const bp = new BasicPitch(MODEL_URL);

    await bp.evaluateModel(
      prepared,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (progress) => {
        if (!this._cancelled) onProgress(progress);
      },
    );

    if (this._cancelled) throw new Error('Cancelled');

    const rawNotes  = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5);
    const withBends = addPitchBendsToNoteEvents(contours, rawNotes);
    const timed     = noteFramesToTime(withBends);

    const notes = timed.map(n => ({
      midi:     n.pitchMidi,
      velocity: Math.round((n.amplitude ?? 0.8) * 127),
      time:     n.startTimeSeconds,
      duration: n.durationSeconds,
    }));

    notes.sort((a, b) => a.time - b.time);
    return notes;
  }

  cancel() {
    this._cancelled = true;
  }
}
