// Web Worker: runs Basic Pitch inference off the main thread.
//
// TF.js calls document.createElement('canvas') at import time to probe WebGL.
// document doesn't exist in workers, so we provide a minimal stub that makes
// every getContext() call return null — TF.js then falls back to CPU cleanly.
// The bundle already calls tf.setBackend('cpu') + exports tf.ready() from
// entry.js, so no further backend wrangling is needed here.

self.document = {
  createElement(tag) {
    if (tag === 'canvas') {
      return {
        getContext:          () => null,
        addEventListener:    () => {},
        removeEventListener: () => {},
        style: {},
        width: 0, height: 0,
      };
    }
    return { style: {}, addEventListener: () => {}, removeEventListener: () => {} };
  },
  createElementNS:  (ns, tag) => self.document.createElement(tag),
  querySelector:    () => null,
  querySelectorAll: () => [],
  getElementById:   () => null,
  body: { appendChild: () => {}, removeChild: () => {}, contains: () => false },
  head: { appendChild: () => {}, removeChild: () => {} },
};

// Some TF.js paths also check window.document
if (typeof window === 'undefined') self.window = self;

try {
  importScripts('basic_pitch_bundle.js');
} catch (e) {
  self.postMessage({ type: 'error', message: `Bundle load failed: ${e.message}` });
  throw e;
}

const { BasicPitch, ready, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly }
  = self.BasicPitchLib;

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe') return;

  try {
    // Wait for CPU backend to be ready (set in bundle's entry.js)
    await ready;

    const { audioData, sampleRate } = data;

    // BasicPitch expects an AudioBuffer-like object with sampleRate + getChannelData(0)
    const audioBuffer = {
      sampleRate,
      numberOfChannels: 1,
      length:   audioData.length,
      duration: audioData.length / sampleRate,
      getChannelData: () => audioData,
    };

    const frames   = [];
    const onsets   = [];
    const contours = [];

    const bp = new BasicPitch('https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json');

    await bp.evaluateModel(
      audioBuffer,
      (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
      (progress) => self.postMessage({ type: 'progress', value: progress }),
    );

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

    self.postMessage({ type: 'done', notes });

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
