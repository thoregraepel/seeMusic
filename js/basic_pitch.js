// basic_pitch.js — main-thread interface to the Basic Pitch Web Worker.
// Loaded as a plain <script>; exposes window.BasicPitchTranscriber.
//
// Usage:
//   const t = new BasicPitchTranscriber();
//   const notes = await t.transcribe(audioBuffer, fraction => console.log(fraction));
//   // notes: [{midi, velocity, time, duration}]

export class BasicPitchTranscriber {
  constructor() {
    this._worker = null;
  }

  // Resample an AudioBuffer to 22050 Hz mono (what Basic Pitch expects).
  async _prepare(audioBuffer) {
    const TARGET_SR = 22050;
    if (audioBuffer.sampleRate === TARGET_SR && audioBuffer.numberOfChannels === 1) {
      return { data: audioBuffer.getChannelData(0).slice(), sampleRate: TARGET_SR };
    }
    const length  = Math.ceil(audioBuffer.duration * TARGET_SR);
    const offline = new OfflineAudioContext(1, length, TARGET_SR);
    const src     = offline.createBufferSource();
    src.buffer    = audioBuffer;
    src.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    return { data: rendered.getChannelData(0).slice(), sampleRate: TARGET_SR };
  }

  transcribe(audioBuffer, onProgress = () => {}) {
    return new Promise(async (resolve, reject) => {
      let { data, sampleRate } = await this._prepare(audioBuffer);

      const worker = new Worker('js/basic_pitch_worker.js');
      this._worker = worker;

      worker.onmessage = ({ data: msg }) => {
        if (msg.type === 'progress') {
          onProgress(msg.value);
        } else if (msg.type === 'done') {
          worker.terminate();
          this._worker = null;
          resolve(msg.notes);
        } else if (msg.type === 'error') {
          worker.terminate();
          this._worker = null;
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (e) => {
        worker.terminate();
        this._worker = null;
        reject(new Error(e.message));
      };

      // Transfer the buffer to the worker (zero-copy)
      worker.postMessage({ type: 'transcribe', audioData: data, sampleRate }, [data.buffer]);
    });
  }

  cancel() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }
}
