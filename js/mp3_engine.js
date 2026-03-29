// MP3/audio file playback engine — Web Audio API (no Tone.js dependency).
// Exposes the same play/pause/stop/seek/getTime/getState interface as audio_engine.js
// so app.js can dispatch to either engine depending on inputMode.

let audioCtx    = null;
let analyserNode = null;
let gainNode     = null;
let audioBuffer  = null;
let sourceNode   = null;

let startTime    = 0;   // audioCtx.currentTime when last play() was called
let pauseOffset  = 0;   // seconds into the buffer at last pause/stop
let _playing     = false;

const FFT_SIZE = 8192;  // gives ~5.4 Hz/bin at 44 100 Hz — resolves semitones from C2 up

export async function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    return;
  }
  audioCtx    = new AudioContext();
  gainNode    = audioCtx.createGain();
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = FFT_SIZE;
  analyserNode.smoothingTimeConstant = 0.75;  // temporal smoothing across frames
  gainNode.connect(audioCtx.destination);
}

/** Decode an ArrayBuffer and prepare it for playback. Returns duration in seconds. */
export async function loadAudioFile(arrayBuffer) {
  await initAudio();
  _stop();
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  pauseOffset = 0;
  return audioBuffer.duration;
}

export function getAnalyserNode() { return micAnalyser ?? analyserNode; }
export function getAudioBuffer()  { return audioBuffer; }
export function getSampleRate()   { return audioCtx ? audioCtx.sampleRate : 44100; }
export function isLoaded()        { return audioBuffer !== null; }
export function setSmoothing(v)   {
  if (analyserNode) analyserNode.smoothingTimeConstant = v;
  if (micAnalyser)  micAnalyser.smoothingTimeConstant  = v;
}

// ── Microphone input ──────────────────────────────────────────────────────────
let micStream   = null;
let micSource   = null;
let micAnalyser = null;  // separate node — intentionally NOT routed to speakers

export async function startMic() {
  await initAudio();
  _stop();  // stop any file playback

  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

  // Create an isolated analyser so mic audio never reaches the speakers
  micAnalyser = audioCtx.createAnalyser();
  micAnalyser.fftSize = FFT_SIZE;
  micAnalyser.smoothingTimeConstant = analyserNode.smoothingTimeConstant;

  micSource = audioCtx.createMediaStreamSource(micStream);
  micSource.connect(micAnalyser);
  // micAnalyser is deliberately left unconnected to gainNode / destination
}

export function stopMic() {
  if (micSource)  { micSource.disconnect();                       micSource  = null; }
  if (micStream)  { micStream.getTracks().forEach(t => t.stop()); micStream  = null; }
  if (micAnalyser){ micAnalyser.disconnect();                     micAnalyser = null; }
}

export function isMicActive() { return micSource !== null; }

function _createSource() {
  if (!audioBuffer) return;
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(analyserNode);
  analyserNode.connect(gainNode);
  sourceNode.addEventListener('ended', () => {
    // 'ended' fires at natural end and also on .stop() — guard with _playing flag
    if (_playing) { _playing = false; pauseOffset = 0; }
  });
}

function _stop() {
  if (sourceNode) {
    try { sourceNode.stop(); } catch (_) {}
    sourceNode.disconnect();
    sourceNode = null;
  }
  _playing = false;
}

export function play() {
  if (!audioBuffer || _playing) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  _createSource();
  startTime = audioCtx.currentTime - pauseOffset;
  sourceNode.start(0, pauseOffset);
  _playing = true;
}

export function pause() {
  if (!_playing) return;
  pauseOffset = Math.max(0, audioCtx.currentTime - startTime);
  _stop();
}

export function stop() {
  pauseOffset = 0;
  _stop();
}

export function seek(seconds) {
  const wasPlaying = _playing;
  _stop();
  pauseOffset = Math.max(0, Math.min(seconds, audioBuffer ? audioBuffer.duration : 0));
  if (wasPlaying) play();
}

export function getTime() {
  if (!audioBuffer) return 0;
  if (_playing) return Math.min(audioCtx.currentTime - startTime, audioBuffer.duration);
  return pauseOffset;
}

export function getState() { return _playing ? 'started' : 'paused'; }

export function setMuted(muted) {
  if (gainNode) gainNode.gain.value = muted ? 0 : 1;
}
