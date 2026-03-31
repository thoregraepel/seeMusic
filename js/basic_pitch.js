// basic_pitch.js — transcribes an AudioBuffer using a Web Worker.
//
// All heavy work (resampling + TF.js CPU inference) runs inside the worker
// so the main thread stays responsive and progress updates fire normally.
//
// Usage:
//   const t = new BasicPitchTranscriber();
//   const notes = await t.transcribe(audioBuffer, fraction => {});
//   // notes: [{midi, velocity, time, duration}]

export class BasicPitchTranscriber {
  constructor() {
    this._worker = null;
    this._cancelled = false;
  }

  // Extract a mono Float32Array from any AudioBuffer (downmix to mono).
  _extractMono(audioBuffer) {
    const n = audioBuffer.length;
    const ch = audioBuffer.numberOfChannels;
    if (ch === 1) {
      // Return a copy so we can transfer it to the worker
      return audioBuffer.getChannelData(0).slice();
    }
    const out = new Float32Array(n);
    for (let c = 0; c < ch; c++) {
      const d = audioBuffer.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i];
    }
    const inv = 1 / ch;
    for (let i = 0; i < n; i++) out[i] *= inv;
    return out;
  }

  async transcribe(audioBuffer, onProgress = () => {}) {
    this._cancelled = false;

    // Downmix on main thread (cheap, synchronous)
    const mono = this._extractMono(audioBuffer);
    const sampleRate = audioBuffer.sampleRate;

    return new Promise((resolve, reject) => {
      const worker = new Worker('js/basic_pitch_worker.js');
      this._worker = worker;

      worker.onmessage = ({ data }) => {
        if (this._cancelled) {
          worker.terminate();
          this._worker = null;
          reject(new Error('Cancelled'));
          return;
        }
        if (data.type === 'progress') {
          onProgress(data.value);
        } else if (data.type === 'done') {
          worker.terminate();
          this._worker = null;
          resolve(data.notes);
        } else if (data.type === 'error') {
          worker.terminate();
          this._worker = null;
          reject(new Error(data.message));
        }
      };

      worker.onerror = (e) => {
        worker.terminate();
        this._worker = null;
        reject(new Error(e.message || 'Worker error'));
      };

      // Transfer the buffer to avoid copying it back
      worker.postMessage(
        { type: 'transcribe', audioData: mono, sampleRate },
        [mono.buffer],
      );
    });
  }

  cancel() {
    this._cancelled = true;
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }
}
