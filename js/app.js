import { MIDI_FILES, generateMidi, loadMidiFile } from './midi_files.js';
import { AUDIO_FILES, loadAudioFilePath } from './audio_files.js';
import { parseMidi } from './midi_parser.js';
import { getActiveNotes } from './scheduler.js';
import * as audio from './audio_engine.js';        // MIDI / Tone.js engine
import * as mp3   from './mp3_engine.js';           // Audio file / Web Audio engine
import { buildNoteRanges, getRawNoteLevels, applyThreshold } from './fft_analyzer.js';
import { init as initVisual, render } from './visual_engine.js';
import { setupUI } from './ui.js';
import { initDial, pitchHue } from './color_dial.js';
import * as phase from './phase_space.js';
import { initMidiInput, clearNotes } from './midi_input.js';
import * as qwerty from './qwerty_keyboard.js';
import * as piano from './piano.js';
import { BasicPitchTranscriber } from './basic_pitch.js';

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  // shared
  inputMode:        'midi',     // 'midi' | 'audio' | 'mic'
  duration:         0,
  showAudio:        true,
  showVisual:       true,
  sfScale:          1.0,
  waveform:         'sawtooth',  // 'sine' | 'square' | 'triangle' | 'sawtooth' | 'sawtooth2'
  superMode:        'sum',
  renderMode:       'circles',
  gridArms:         2,
  gridPhase:        0,   // degrees; converted to radians when passed to render
  hyperbolic:       false,
  colorMode:        true,
  hueOffset:        0,     // degrees [0, 360): which hue C maps to
  hueDirection:     1,     // +1 = CW ascending pitch, -1 = CCW
  tilt:             0,
  // phase-space embedding
  phaseTauMs:       0.1,
  phaseTrailSec:    1,
  phaseStride:      1,
  phaseLpCutoff:    5800,
  phaseMode3d:      true,
  phasePointSize:   2.5,
  phaseColorScheme: 'plasma',
  phaseColorMode:   'pitch',  // 'age' | 'pitch'
  phaseAutoTau:     false,
  phaseLines:       false,
  phaseAutocam:     false,
  syncMeasure:      false,
  // midi-mode only
  allNotes:         [],
  tonicMidi:        60,
  originalDuration: 0,
  keyName:          'C major (default)',
  audioReady:       false,
  tempoScale:       1.0,
  visualLeadMs:     22,
  // audio-mode only
  fftThreshold:     -70,        // dBFS; notes below this are ignored
  fftTopN:          6,          // keep only the N loudest FFT notes (contrast control)
  fftLowMidi:       24,         // C1 — lowest pitch passed to renderer
  fftHighMidi:      96,         // C7 — highest pitch passed to renderer
  fftGain:          4.0,        // velocity multiplier before render (boosts contrast)
  fftSmoothing:     0.75,       // AnalyserNode smoothingTimeConstant (0 = jittery, 1 = sluggish)
  fftThresholdTilt: 3,          // dB/octave; +ve raises threshold for high notes (suppresses overtones)
  // live MIDI keyboard
  liveMode:         false,      // true = use live MIDI input instead of scheduled file
  liveNotes:        [],         // [{midi, velocity}] from MIDI keyboard
  // QWERTY piano keyboard
  qwertyEnabled:    false,
  qwertyNotes:      new Map(),  // midi → {midi, velocity}
  showPiano:        true,
  // audio + paired MIDI visualisation
  audioMidiNotes:   [],         // notes from a MIDI file paired with the current audio file
  audioMidiMode:    false,      // true = use audioMidiNotes for visuals instead of FFT
};

// FFT analyser state (initialised once an audio file is loaded)
let fftNoteRanges = null;
let fftFreqBuf    = null;

// ── Sync measurement ──────────────────────────────────────────────────────────
const syncRenders = [];
const SYNC_MAX    = 30;

function updateSyncDisplay(renderMs) {
  syncRenders.push(renderMs);
  if (syncRenders.length > SYNC_MAX) syncRenders.shift();
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mr   = mean(syncRenders);
  const panel = document.getElementById('sync-panel');
  if (!panel) return;
  panel.innerHTML =
    `<b>Sync measurement</b> (n=${syncRenders.length})<br>` +
    `canvas render:  <b>${mr.toFixed(1)} ms</b> (mean)<br>` +
    `display lag \u2248 <b>${(mr+16).toFixed(0)} ms</b> (render + 1 frame)<br>` +
    `visual lead:    <b>${state.visualLeadMs.toFixed(0)} ms</b> (current offset)<br>` +
    `<span style="color:#888;font-size:11px">last render: ${renderMs.toFixed(1)}ms</span>`;
}

let ui;
let dial            = null;
let rafId           = null;
let phaseInitialized = false;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initVisual(document.getElementById('grating-canvas'));
  piano.init(document.getElementById('piano-canvas'), (low, high) => {
    state.fftLowMidi  = low;
    state.fftHighMidi = high;
    ui.setNoteRange(low, high);
  });

  ui = setupUI({
    midiFiles:   MIDI_FILES,
    audioFiles:  AUDIO_FILES,
    onAudioSelect: async idx => {
      const f = AUDIO_FILES[idx];
      try {
        const buf = await loadAudioFilePath(f.path);
        await loadAudioBuffer(buf, f.name);
      } catch (err) {
        console.error('Preloaded audio load error:', err);
        alert(`Could not load "${f.name}".\nFile may be missing — see audio_files.js for download instructions.`);
      }
    },
    onSelect:    idx  => loadAndSchedule(MIDI_FILES[idx]),
    onCustomFile:(buf, name) => loadAndSchedule({ type: 'buffer', buffer: buf, name }),
    onAudioFile: (buf, name) => loadAudioBuffer(buf, name),
    onPlay:      handlePlayPause,
    onStop:      handleStop,
    onSeek:      handleSeek,
    onAudioToggle: () => {
      state.showAudio = !state.showAudio;
      if (state.inputMode === 'audio' || state.inputMode === 'mic') mp3.setMuted(!state.showAudio);
      else audio.setMuted(!state.showAudio);
      return state.showAudio;
    },
    onVisualToggle: () => { state.showVisual = !state.showVisual; return state.showVisual; },
    onSfScale:   v => { state.sfScale    = v; },
    onWaveform:  v => { state.waveform   = v; },
    onSuperMode: v => { state.superMode  = v; },
    onRenderMode: v => {
      state.renderMode = v;
      if (v === 'phase') {
        const c = document.getElementById('phase-container');
        if (!phaseInitialized) {
          phase.init(c);
          phaseInitialized = true;
        } else {
          phase.resize(c);
        }
      }
    },
    onPhaseTauMs:       v => { state.phaseTauMs       = v; },
    onPhaseTrailSec:    v => { state.phaseTrailSec    = v; },
    onPhaseStride:      v => { state.phaseStride      = v; },
    onPhaseLpCutoff:    v => { state.phaseLpCutoff    = v; },
    onPhasePointSize:   v => { state.phasePointSize   = v; },
    onPhaseColorScheme: v => { state.phaseColorScheme = v; },
    onPhaseColorMode: () => {
      state.phaseColorMode = state.phaseColorMode === 'age' ? 'pitch' : 'age';
      return state.phaseColorMode;
    },
    onPhaseAutoTau: () => {
      state.phaseAutoTau = !state.phaseAutoTau;
      return state.phaseAutoTau;
    },
    onPhaseLines: () => {
      state.phaseLines = !state.phaseLines;
      return state.phaseLines;
    },
    onPhaseAutocam: () => {
      state.phaseAutocam = !state.phaseAutocam;
      return state.phaseAutocam;
    },
    onPhaseMode3d: () => {
      state.phaseMode3d = !state.phaseMode3d;
      phase.reset();
      return state.phaseMode3d;
    },
    onPhaseReset: () => phase.reset(),
    onGridArms:  v => { state.gridArms  = v; },
    onGridPhase: v => { state.gridPhase = v; },
    onTilt:      v => { state.tilt       = v; },
    onHyperbolic:  () => { state.hyperbolic = !state.hyperbolic; return state.hyperbolic; },
    onColorMode:   () => { state.colorMode  = !state.colorMode;  return state.colorMode;  },
    onSyncMeasureToggle: () => {
      state.syncMeasure = !state.syncMeasure;
      if (state.syncMeasure) syncRenders.length = 0;
      return state.syncMeasure;
    },
    onVisualLead:    ms    => { state.visualLeadMs  = ms; },
    onTempoScale:    scale => {
      state.tempoScale = scale;
      state.duration   = state.originalDuration / scale;
      if (state.audioReady && state.inputMode === 'midi') {
        scheduleWithTempo();
        ui.setPlayButton('▶ Play');
      }
      ui.setProgress(0, state.duration);
      ui.setTimeDisplay(0, state.duration);
    },
    onFftThreshold: db => { state.fftThreshold = db; },
    onFftTopN:       n  => { state.fftTopN      = n;  },
    onFftLowMidi:    n  => { state.fftLowMidi   = n;  },
    onFftHighMidi:   n  => { state.fftHighMidi  = n;  },
    onFftGain:       v  => { state.fftGain      = v;  },
    onFftSmoothing:     v => { state.fftSmoothing     = v; mp3.setSmoothing(v); },
    onFftThresholdTilt: v => { state.fftThresholdTilt = v; },
    onMicToggle: () => {
      if (state.inputMode === 'mic') {
        mp3.stopMic();
        state.inputMode = 'midi';
        ui.setModeIndicator('midi');
        ui.setPlayButton('▶ Play');
        return false;
      } else {
        mp3.startMic()
          .then(() => {
            fftNoteRanges = buildNoteRanges(mp3.getSampleRate(), 8192);
            fftFreqBuf    = new Float32Array(mp3.getAnalyserNode().frequencyBinCount);
            state.inputMode = 'mic';
            state.duration  = 0;
            ui.setModeIndicator('mic');
            ui.setLoadedFile('Microphone');
            ui.setKeyDisplay('—');
            ui.setProgress(0, 0);
            ui.setTimeDisplay(0, 0);
            ui.setPlayButton('▶ Play');
          })
          .catch(err => {
            console.error('Mic error:', err);
            alert('Microphone access denied or unavailable.');
          });
        return true;
      }
    },
    onPianoToggle: () => {
      state.showPiano = !state.showPiano;
      document.getElementById('piano-row').classList.toggle('hidden', !state.showPiano);
      return state.showPiano;
    },
    onAudioMidiFile: (buf, name) => loadAudioMidi(buf, name),
    onTranscribe: () => transcribeAudio(),
    onAudioMidiToggle: () => {
      if (!state.audioMidiNotes.length) return false;
      state.audioMidiMode = !state.audioMidiMode;
      return state.audioMidiMode;
    },
    onColorWheel: () => {
      const pop = document.getElementById('color-wheel-popover');
      pop.classList.toggle('visible');
    },
    onKeyHueRotate: delta => {
      state.hueOffset = ((state.hueOffset + delta) % 360 + 360) % 360;
      if (dial) dial.setOffset(state.hueOffset);
    },
    onKeyDirectionFlip: () => {
      state.hueDirection = -state.hueDirection;
      if (dial) dial.setDirection(state.hueDirection);
    },
    onKeyDefaults: () => {
      state.sfScale = 1; state.waveform = 'sawtooth'; state.renderMode = 'circles';
      state.gridArms = 2; state.gridPhase = 0; state.superMode = 'sum'; state.tilt = 0;
      state.colorMode = true; state.hyperbolic = false;
      state.hueOffset = 0; state.hueDirection = 1;
      if (dial) { dial.setOffset(0); dial.setDirection(1); }
      ui.setColorMode(true);
      ui.setHyperbolic(false);
    },
    onQwertyToggle: () => {
      state.qwertyEnabled = !state.qwertyEnabled;
      qwerty.setEnabled(state.qwertyEnabled);
      return { enabled: state.qwertyEnabled, octave: qwerty.getBaseOctave() };
    },
    onLiveMode: async () => {
      if (!state.liveMode) {
        try {
          const names = await initMidiInput(notes => { state.liveNotes = notes; });
          state.liveMode = true;
          ui.setMidiStatus(names);
          return true;
        } catch (err) {
          ui.setMidiStatus(null, err.message);
          return false;
        }
      } else {
        state.liveMode = false;
        clearNotes();
        state.liveNotes = [];
        ui.setMidiStatus([]);
        return false;
      }
    },
  });

  // QWERTY piano keyboard
  qwerty.init({
    noteOn: (midi, vel) => {
      if (state.audioReady) audio.noteOn(midi, vel);
      state.qwertyNotes.set(midi, { midi, velocity: vel });
    },
    noteOff: (midi) => {
      audio.noteOff(midi);
      state.qwertyNotes.delete(midi);
    },
    octaveChange: (oct) => ui.setQwertyOctave(oct),
  });

  // Colour-wheel dial
  dial = initDial(document.getElementById('color-dial-mount'), ({ offset, direction }) => {
    state.hueOffset    = offset;
    state.hueDirection = direction;
  });

  // Close colour-wheel popover when clicking outside it
  document.addEventListener('click', e => {
    const pop = document.getElementById('color-wheel-popover');
    const btn = document.getElementById('btn-color-wheel');
    if (pop.classList.contains('visible') && !pop.contains(e.target) && e.target !== btn) {
      pop.classList.remove('visible');
    }
  });

  // Overlay: click anywhere → init MIDI audio and load default file
  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', async () => {
    await audio.initAudio();
    state.audioReady = true;
    overlay.style.display = 'none';
    await loadAndSchedule(MIDI_FILES[0]);
    startRaf();
  });

  // Demo button
  document.getElementById('btn-demo').addEventListener('click', async (e) => {
    e.stopPropagation();
    document.body.classList.add('app-fullscreen');
    await audio.initAudio();
    state.audioReady = true;
    overlay.style.display = 'none';
    state.colorMode  = true;
    state.hyperbolic = false;
    ui.setColorMode(true);
    ui.setHyperbolic(false);
    const bachFile = MIDI_FILES.find(f => f.path && f.path.includes('Bach'));
    await loadAndSchedule(bachFile);
    startRaf();
    audio.play();
    ui.setPlayButton('⏸ Pause');
  });

  startRaf();
});

// ── MIDI helpers ──────────────────────────────────────────────────────────────
function scheduleWithTempo() {
  const s = state.tempoScale;
  audio.scheduleNotes(state.allNotes.map(n => ({ ...n, time: n.time / s, duration: n.duration / s })));
}

async function loadAndSchedule(descriptor) {
  let buf;
  try {
    if (descriptor.type === 'generated') buf = generateMidi(descriptor.generator);
    else if (descriptor.type === 'buffer') buf = descriptor.buffer;
    else buf = await loadMidiFile(descriptor.path);
  } catch (err) { console.error('MIDI load error:', err); return; }

  let parsed;
  try { parsed = parseMidi(buf); }
  catch (err) { console.error('MIDI parse error:', err); return; }

  state.inputMode       = 'midi';
  state.allNotes        = parsed.allNotes;
  state.tonicMidi       = parsed.tonicMidi;
  state.originalDuration = parsed.duration;
  state.duration        = parsed.duration / state.tempoScale;
  state.keyName         = parsed.keyName;

  ui.setKeyDisplay(state.keyName);
  ui.setProgress(0, state.duration);
  ui.setTimeDisplay(0, state.duration);
  ui.setModeIndicator('midi');
  ui.setLoadedFile(descriptor.name || '');

  if (state.audioReady) scheduleWithTempo();
  ui.setPlayButton('▶ Play');
}

// ── Audio + paired MIDI helpers ───────────────────────────────────────────────
function loadAudioMidi(arrayBuffer, filename) {
  let parsed;
  try { parsed = parseMidi(arrayBuffer); }
  catch (err) { console.error('MIDI pair parse error:', err); return; }

  _applyAudioMidiNotes(parsed.allNotes, parsed.keyName);
  console.log(`Paired MIDI "${filename}": ${parsed.allNotes.length} notes, ${parsed.duration.toFixed(1)}s`);
}

function _applyAudioMidiNotes(notes, keyName = '—') {
  state.audioMidiNotes = notes;
  state.audioMidiMode  = true;
  ui.setAudioMidiVis(true, true);
  ui.setKeyDisplay(keyName);
}

let _transcriber = null;

async function transcribeAudio() {
  const buf = mp3.getAudioBuffer();
  if (!buf) return;

  // Cancel any in-flight transcription
  if (_transcriber) { _transcriber.cancel(); _transcriber = null; }

  _transcriber = new BasicPitchTranscriber();
  ui.setTranscribeButton('Transcribing…  0%', true);

  try {
    const notes = await _transcriber.transcribe(buf, (p) => {
      ui.setTranscribeButton(`Transcribing… ${Math.round(p * 100)}%`, true);
    });
    _transcriber = null;
    _applyAudioMidiNotes(notes);
    ui.setTranscribeButton('Transcribed ✓', false);
    console.log(`Transcription complete: ${notes.length} notes`);
  } catch (err) {
    _transcriber = null;
    ui.setTranscribeButton('Transcribe ✗', false);
    console.error('Transcription error:', err);
    alert(`Transcription failed: ${err.message}`);
  }
}

// ── Audio file helpers ────────────────────────────────────────────────────────
async function loadAudioBuffer(arrayBuffer, filename) {
  const duration = await mp3.loadAudioFile(arrayBuffer);

  fftNoteRanges = buildNoteRanges(mp3.getSampleRate(), 8192);
  fftFreqBuf    = new Float32Array(mp3.getAnalyserNode().frequencyBinCount);

  state.inputMode      = 'audio';
  state.audioMidiMode  = false;
  state.duration       = duration;

  ui.setKeyDisplay('—');
  ui.setProgress(0, duration);
  ui.setTimeDisplay(0, duration);
  ui.setModeIndicator('audio');
  ui.setLoadedFile(filename);
  ui.setPlayButton('▶ Play');
  ui.setTranscribeButton('Transcribe', false);
  ui.setAudioMidiVis(false, state.audioMidiNotes.length > 0);
}

// ── Transport controls ────────────────────────────────────────────────────────
function handlePlayPause() {
  if (state.inputMode === 'audio') {
    if (!mp3.isLoaded()) return '▶ Play';
    if (mp3.getState() === 'started') { mp3.pause(); return '▶ Play'; }
    else { mp3.play(); return '⏸ Pause'; }
  } else {
    if (!state.audioReady) return '▶ Play';
    if (audio.getState() === 'started') { audio.pause(); return '▶ Play'; }
    else { audio.play(); return '⏸ Pause'; }
  }
}

function handleStop() {
  if (state.inputMode === 'audio') { mp3.stop(); }
  else { if (!state.audioReady) return; audio.stop(); }
  ui.setProgress(0, state.duration);
  ui.setTimeDisplay(0, state.duration);
}

function handleSeek(seconds) {
  if (state.inputMode === 'audio') mp3.seek(seconds);
  else { if (state.audioReady) audio.seek(seconds); }
}

// ── Render loop ───────────────────────────────────────────────────────────────
function startRaf() {
  if (rafId !== null) return;
  function frame() {
    let t, active, pianoNotes;

    if (state.liveMode) {
      t          = 0;
      pianoNotes = state.liveNotes;
      active     = state.liveNotes.filter(n => n.midi >= state.fftLowMidi && n.midi <= state.fftHighMidi);
    } else if (state.inputMode === 'audio' || state.inputMode === 'mic') {
      t = state.inputMode === 'audio' ? mp3.getTime() : 0;

      if (state.audioMidiMode && state.inputMode === 'audio' && state.audioMidiNotes.length > 0) {
        // MIDI-driven visualisation: use paired MIDI notes clocked to the audio position
        const tLook = t + state.visualLeadMs / 1000;
        pianoNotes  = getActiveNotes(state.audioMidiNotes, tLook);
        active      = pianoNotes.filter(n => n.midi >= state.fftLowMidi && n.midi <= state.fftHighMidi);
      } else {
        // FFT visualisation (default audio mode)
        const rawLevels = fftNoteRanges
          ? getRawNoteLevels(mp3.getAnalyserNode(), fftNoteRanges, fftFreqBuf)
          : [];
        pianoNotes = rawLevels;  // {midi, db} — piano draws absolute dBFS bars
        let notes = fftNoteRanges
          ? applyThreshold(rawLevels, state.fftThreshold, state.fftThresholdTilt)
          : [];
        notes = notes.filter(n => n.midi >= state.fftLowMidi && n.midi <= state.fftHighMidi);
        notes = notes.slice(0, state.fftTopN);
        if (state.fftGain !== 1.0)
          notes = notes.map(n => ({ ...n, velocity: Math.min(1, n.velocity * state.fftGain) }));
        if (state.renderMode === 'grid' && state.superMode !== 'sum' && !state.colorMode) {
          notes = notes.slice(0, 24);
        }
        active = notes;
      }
    } else {
      t = state.audioReady ? audio.getTime() : 0;
      const tLook = (t + state.visualLeadMs / 1000) * state.tempoScale;
      pianoNotes = getActiveNotes(state.allNotes, tLook);
      active     = pianoNotes.filter(n => n.midi >= state.fftLowMidi && n.midi <= state.fftHighMidi);
    }

    // Merge QWERTY notes into active + pianoNotes
    if (state.qwertyEnabled && state.qwertyNotes.size > 0) {
      const activeMidi = new Set(active.map(n => n.midi));
      const pianoMidi  = new Set(pianoNotes.map(n => n.midi));
      for (const note of state.qwertyNotes.values()) {
        if (!activeMidi.has(note.midi)) active.push(note);
        if (!pianoMidi.has(note.midi))  pianoNotes.push(note);
      }
    }

    if (state.duration > 0 && !state.liveMode) {
      ui.setProgress(Math.min(t, state.duration), state.duration);
      ui.setTimeDisplay(t, state.duration);
    }

    ui.setNotesDisplay(active);

    const syncT0 = state.syncMeasure ? performance.now() : 0;
    if (state.renderMode === 'phase') {
      const analyser = (state.inputMode === 'audio' || state.inputMode === 'mic')
        ? mp3.getAnalyserNode()
        : audio.getAnalyserNode();

      // Velocity-weighted circular mean of active pitch-class hues.
      // Using circular mean (sin/cos) handles the wraparound at 0°/360°.
      let noteHue = 0;
      if (active.length > 0) {
        let sinSum = 0, cosSum = 0;
        for (const n of active) {
          const h = pitchHue(n.midi, state.hueOffset, state.hueDirection) * Math.PI / 180;
          const v = n.velocity ?? 1;
          sinSum += Math.sin(h) * v;
          cosSum += Math.cos(h) * v;
        }
        noteHue = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;
      }

      // Read back the auto-τ estimate and sync slider display
      if (state.phaseAutoTau) {
        const v = phase.getAutoTauMs();
        if (Math.abs(v - state.phaseTauMs) > 0.01) {
          state.phaseTauMs = v;
          ui.setPhaseTau(v);
        }
      }

      phase.update(analyser, {
        tauMs:          state.phaseTauMs,
        autoTau:        state.phaseAutoTau,
        stride:         state.phaseStride,
        trailSec:       state.phaseTrailSec,
        lpCutoffHz:     state.phaseLpCutoff,
        mode3d:         state.phaseMode3d,
        pointSize:      state.phasePointSize,
        colorScheme:    state.phaseColorScheme,
        phaseColorMode: state.phaseColorMode,
        noteHue,
        drawLines:      state.phaseLines,
        autocam:        state.phaseAutocam,
      });
    } else {
      render(active, {
        showVisual: state.showVisual,
        sfScale:    state.sfScale,
        waveform:   state.waveform,
        superMode:  state.superMode,
        renderMode: state.renderMode,
        hyperbolic: state.hyperbolic,
        colorMode:    state.colorMode,
        hueOffset:    state.hueOffset,
        hueDirection: state.hueDirection,
        tilt:         state.tilt,
        gridArms:     state.gridArms,
        gridPhase:    state.gridPhase * Math.PI / 180,
      });
    }
    if (state.syncMeasure) updateSyncDisplay(performance.now() - syncT0);

    if (state.showPiano) {
      const isRawAudio = (state.inputMode === 'audio' || state.inputMode === 'mic') && !state.audioMidiMode;
      piano.draw(
        pianoNotes, active, state.fftLowMidi, state.fftHighMidi, state.colorMode,
        isRawAudio ? state.fftThreshold     : undefined,
        isRawAudio ? state.fftThresholdTilt : undefined,
        state.hueOffset, state.hueDirection,
      );
    }

    // Auto-stop (not applicable in live or mic mode)
    if (!state.liveMode && state.inputMode !== 'mic') {
      const playing = state.inputMode === 'audio' ? mp3.getState() === 'started'
        : state.audioReady && audio.getState() === 'started';
      if (playing && t >= state.duration && state.duration > 0) {
        if (state.inputMode === 'audio') mp3.stop(); else audio.stop();
        ui.setPlayButton('▶ Play');
      }
    }

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

// ── Service worker (PWA) ──────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/seeMusic/sw.js').catch(() => {});
}
