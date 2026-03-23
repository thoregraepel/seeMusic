// FFT → MIDI note amplitude mapper.
// Maps Web Audio AnalyserNode FFT magnitude data to 88 piano notes (A0–C8, MIDI 21–108).
//
// For each MIDI note n, we look at the half-semitone band [f·2^(-1/24), f·2^(+1/24)]
// centred on its fundamental frequency f = 440·2^((n-69)/12) Hz, and take the peak
// magnitude (in dBFS) within that band. Notes above the threshold are returned as
// { midi, velocity } objects where velocity is linearly mapped from threshold → 0 dB.
//
// FFT resolution note:
//   At 44 100 Hz and fftSize 8192 → 4096 bins → ~5.4 Hz/bin.
//   Semitone width at C2 (65 Hz) ≈ 3.9 Hz — barely resolved; one octave up it is fine.
//   Sub-bass (A0–B1) will blend slightly, but those pitches are rarely prominent.

const MIDI_MIN = 21;   // A0
const MIDI_MAX = 108;  // C8

// Pre-compute bin index ranges for each of the 88 piano notes given a sample rate
// and FFT size. Call once after the AudioContext is known.
export function buildNoteRanges(sampleRate, fftSize) {
  const binHz   = sampleRate / fftSize;         // Hz per FFT bin
  const halfBin = 1 / 24;                       // half a semitone in octaves
  const ranges  = [];
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    const fCenter = 440 * Math.pow(2, (midi - 69) / 12);
    const fLow    = fCenter * Math.pow(2, -halfBin);
    const fHigh   = fCenter * Math.pow(2,  halfBin);
    const binLow  = Math.max(0, Math.floor(fLow  / binHz));
    const binHigh =              Math.ceil(fHigh  / binHz);
    ranges.push({ midi, binLow, binHigh });
  }
  return ranges;
}

/**
 * Read the current FFT frame and return active notes above thresholdDb.
 *
 * @param {AnalyserNode} analyserNode
 * @param {Array}        noteRanges   — from buildNoteRanges()
 * @param {Float32Array} freqBuf      — reusable buffer, length = analyserNode.frequencyBinCount
 * @param {number}       thresholdDb    — base threshold at C4, e.g. -50 (dBFS)
 * @param {number}       thresholdTilt  — dB/octave slope; +3 raises threshold for high notes
 * @returns {Array<{midi, velocity}>} sorted loudest-first, velocity in [0,1]
 */
export function getNotesFromFft(analyserNode, noteRanges, freqBuf, thresholdDb, thresholdTilt = 0) {
  analyserNode.getFloatFrequencyData(freqBuf);
  const maxBin = freqBuf.length - 1;

  const notes = [];
  for (const { midi, binLow, binHigh } of noteRanges) {
    let peak = -Infinity;
    const hi = Math.min(binHigh, maxBin);
    for (let b = binLow; b <= hi; b++) {
      if (freqBuf[b] > peak) peak = freqBuf[b];
    }
    // Effective threshold rises/falls with pitch relative to C4 (midi 60)
    const effThreshold = thresholdDb + thresholdTilt * (midi - 60) / 12;
    const effRange     = Math.max(1, -effThreshold);  // dB span threshold → 0 dBFS
    if (peak > effThreshold) {
      notes.push({ midi, velocity: Math.min(1, (peak - effThreshold) / effRange) });
    }
  }

  // Sort loudest first so callers can easily take top-N
  notes.sort((a, b) => b.velocity - a.velocity);
  return notes;
}
