// Web Worker: resamples audio then runs Basic Pitch inference.
//
// Uses TF.js WASM backend (with SIMD if available) for ~5-10x speedup over
// the pure-JS CPU backend.  Falls back to CPU if WASM fails to load.
//
// The WASM files (tfjs-backend-wasm*.wasm) must be served from js/ alongside
// this worker.  setWasmPaths('./') resolves relative to this worker's URL, i.e.
// the same js/ directory.
//
// TF.js probes for WebGL by calling document.createElement('canvas'); we stub
// document so every getContext() returns null (no WebGL in workers).

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
  createElementNS:  (_ns, tag) => self.document.createElement(tag),
  querySelector:    () => null,
  querySelectorAll: () => [],
  getElementById:   () => null,
  body: { appendChild: () => {}, removeChild: () => {}, contains: () => false },
  head: { appendChild: () => {}, removeChild: () => {} },
};

if (typeof window === 'undefined') self.window = self;

try {
  importScripts('basic_pitch_bundle.js');
} catch (e) {
  self.postMessage({ type: 'error', message: `Bundle load failed: ${e.message}` });
  throw e;
}

const { tf, setWasmPaths, BasicPitch, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly }
  = self.BasicPitchLib;

// Initialise backend once, lazily (first transcription request)
let _backendReady = null;
function ensureBackend() {
  if (_backendReady) return _backendReady;
  _backendReady = (async () => {
    // WASM files live in the same directory as this worker script
    setWasmPaths('./');
    try {
      await tf.setBackend('wasm');
      await tf.ready();
      console.log('[BasicPitch worker] backend: wasm');
    } catch (e) {
      console.warn('[BasicPitch worker] WASM failed, falling back to cpu:', e.message);
      await tf.setBackend('cpu');
      await tf.ready();
    }
  })();
  return _backendReady;
}

// Linear interpolation resample (mono Float32Array, any rate → 22050 Hz)
function resampleTo22050(data, fromRate) {
  const TARGET = 22050;
  if (fromRate === TARGET) return data;
  const ratio  = fromRate / TARGET;
  const outLen = Math.ceil(data.length / ratio);
  const out    = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos  = i * ratio;
    const lo   = Math.floor(pos);
    const hi   = Math.min(lo + 1, data.length - 1);
    const frac = pos - lo;
    out[i] = data[lo] * (1 - frac) + data[hi] * frac;
  }
  return out;
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe') return;

  try {
    await ensureBackend();

    const { audioData, sampleRate } = data;
    const resampled = resampleTo22050(audioData, sampleRate);

    const audioBuffer = {
      sampleRate:       22050,
      numberOfChannels: 1,
      length:           resampled.length,
      duration:         resampled.length / 22050,
      getChannelData:   () => resampled,
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
