// basic_pitch.js — runs Basic Pitch on the main thread using WebGL (via TF.js).
//
// The bundle is lazy-loaded on first use. TF.js auto-selects WebGL on the
// main thread, which is 20-50x faster than CPU. model.executeAsync with
// WebGL does async GPU readback between batches, so the event loop gets
// turns and progress updates fire normally.
//
// Usage:
//   const t = new BasicPitchTranscriber();
//   const notes = await t.transcribe(audioBuffer, fraction => {});
//   // notes: [{midi, velocity, time, duration}]

const MODEL_URL = 'https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json';

let _bundleReady = null;
function loadBundle() {
  if (_bundleReady) return _bundleReady;
  _bundleReady = new Promise((resolve, reject) => {
    if (window.BasicPitchLib) { resolve(); return; }
    const script  = document.createElement('script');
    script.src    = 'js/basic_pitch_bundle.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load basic_pitch_bundle.js'));
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

    await ready;   // TF.js backend (WebGL or fallback) initialised

    const prepared = await this._prepare(audioBuffer);
    if (this._cancelled) throw new Error('Cancelled');

    const frames   = [];
    const onsets   = [];
    const contours = [];

    const bp = new BasicPitch(MODEL_URL);
    await bp.evaluateModel(
      prepared,
      (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
      (progress) => { if (!this._cancelled) onProgress(progress); },
    );

    if (this._cancelled) throw new Error('Cancelled');

    const notes = noteFramesToTime(
      addPitchBendsToNoteEvents(
        contours,
        outputToNotesPoly(frames, onsets, 0.25, 0.25, 5),
      ),
    ).map(n => ({
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
