// Web Worker: runs Basic Pitch inference off the main thread.
// Loads the bundled IIFE (basic_pitch_bundle.js) which exposes BasicPitchLib.
//
// Messages in:
//   { type: 'transcribe', audioData: Float32Array, sampleRate: number }
// Messages out:
//   { type: 'progress', value: 0..1 }
//   { type: 'done', notes: [{midi, velocity, time, duration}] }
//   { type: 'error', message: string }

try {
  importScripts('basic_pitch_bundle.js');
} catch (e) {
  self.postMessage({ type: 'error', message: `Failed to load bundle: ${e.message}` });
}

const { BasicPitch, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly } = BasicPitchLib;

const MODEL_URL = 'https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json';

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe') return;

  try {
    const { audioData, sampleRate } = data;

    // Wrap the transferred Float32Array in an AudioBuffer-like object.
    // BasicPitch.evaluateModel needs: { sampleRate, getChannelData(0) }
    const audioBuffer = {
      sampleRate,
      numberOfChannels: 1,
      length: audioData.length,
      duration: audioData.length / sampleRate,
      getChannelData: () => audioData,
    };

    const bp = new BasicPitch(MODEL_URL);

    const frames   = [];
    const onsets   = [];
    const contours = [];

    await bp.evaluateModel(
      audioBuffer,
      (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
      (progress) => self.postMessage({ type: 'progress', value: progress }),
    );

    const rawNotes   = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5);
    const withBends  = addPitchBendsToNoteEvents(contours, rawNotes);
    const timed      = noteFramesToTime(withBends);

    // Convert to {midi, velocity, time, duration} — same shape as midi_parser.js notes
    const notes = timed.map(n => ({
      midi:     n.pitchMidi,
      velocity: Math.round((n.amplitude ?? 0.8) * 127),
      time:     n.startTimeSeconds,
      duration: n.durationSeconds,
    }));

    // Must be sorted by time for getActiveNotes() binary search
    notes.sort((a, b) => a.time - b.time);

    self.postMessage({ type: 'done', notes });

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
