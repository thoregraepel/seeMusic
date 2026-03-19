import { MIDI_FILES, generateMidi, loadMidiFile } from './midi_files.js';
import { parseMidi } from './midi_parser.js';
import { getActiveNotes } from './scheduler.js';
import * as audio from './audio_engine.js';
import { init as initVisual, render } from './visual_engine.js';
import { setupUI } from './ui.js';

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  allNotes:         [],
  tonicMidi:        60,
  duration:         0,
  originalDuration: 0,
  keyName:          'C major (default)',
  showAudio:        true,
  showVisual:       true,
  audioReady:       false,
  sfScale:          1.0,      // spatial frequency multiplier (set from slider)
  waveform:         'sine',   // 'sine' | 'square' | 'triangle' | 'sawtooth'
  superMode:        'sum',    // 'sum' | 'product' | 'max'
  renderMode:       'circles', // 'circles' | 'grid'
  hyperbolic:       false,
  colorMode:        false,
  tilt:             0,        // spectral tilt: >0 boosts highs, <0 boosts lows
  tempoScale:       1.0,      // playback speed multiplier (0.5–2.0)
  syncMeasure:      false,    // audio-visual sync measurement mode
  visualLeadMs:     22,       // ms to read ahead for note selection (compensates display lag)
};

// ── Sync measurement state ────────────────────────────────────────────────────
const syncRenders = [];  // last N render durations (ms)
const SYNC_MAX_RESULTS = 30;

// Visual display lag = canvas render time + 1 vsync frame (~16ms).
// This is what needs to be compensated via VISUAL_LEAD_S.
function updateSyncDisplay(renderMs) {
  syncRenders.push(renderMs);
  if (syncRenders.length > SYNC_MAX_RESULTS) syncRenders.shift();

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const meanRender = mean(syncRenders);
  const displayLag = meanRender + 16; // +1 vsync frame

  console.log(`[sync] render=${renderMs.toFixed(1)}ms | mean render=${meanRender.toFixed(1)}ms display lag\u2248${displayLag.toFixed(0)}ms (n=${syncRenders.length})`);

  const panel = document.getElementById('sync-panel');
  if (!panel) return;
  panel.innerHTML =
    `<b>Sync measurement</b> (n=${syncRenders.length})<br>` +
    `canvas render:  <b>${meanRender.toFixed(1)} ms</b> (mean)<br>` +
    `display lag \u2248 <b>${displayLag.toFixed(0)} ms</b> (render + 1 frame)<br>` +
    `visual lead:    <b>${(state.visualLeadMs).toFixed(0)} ms</b> (current offset)<br>` +
    `<span style="color:#888;font-size:11px">last render: ${renderMs.toFixed(1)}ms</span>`;
}

let ui;
let rafId = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initVisual(document.getElementById('grating-canvas'));

  ui = setupUI({
    midiFiles: MIDI_FILES,
    onSelect:        idx => loadAndSchedule(MIDI_FILES[idx]),
    onCustomFile:    (buf, name) => loadAndSchedule({ type: 'buffer', buffer: buf, name }),
    onPlay:          handlePlayPause,
    onStop:          handleStop,
    onSeek:          handleSeek,
    onAudioToggle:    () => { state.showAudio  = !state.showAudio; audio.setMuted(!state.showAudio); return state.showAudio; },
    onVisualToggle:   () => { state.showVisual = !state.showVisual; return state.showVisual; },
    onSfScale:      v => { state.sfScale     = v; },
    onWaveform:     v => { state.waveform    = v; },
    onSuperMode:    v => { state.superMode   = v; },
    onRenderMode:   v => { state.renderMode  = v; },
    onTilt:         v => { state.tilt        = v; },
    onHyperbolic:   () => { state.hyperbolic = !state.hyperbolic; return state.hyperbolic; },
    onColorMode:    () => { state.colorMode  = !state.colorMode;  return state.colorMode;  },
    onSyncMeasureToggle:  () => {
      state.syncMeasure = !state.syncMeasure;
      if (state.syncMeasure) { syncRenders.length = 0; }
      return state.syncMeasure;
    },
    onVisualLead: ms => { state.visualLeadMs = ms; },
    onTempoScale: scale => {
      state.tempoScale = scale;
      state.duration   = state.originalDuration / scale;
      if (state.audioReady) {
        scheduleWithTempo();
        ui.setPlayButton('▶ Play');
      }
      ui.setProgress(0, state.duration);
      ui.setTimeDisplay(0, state.duration);
    },
  });

  // Dismiss overlay on click / interaction → starts audio context
  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', async () => {
    await audio.initAudio();
    state.audioReady = true;
    overlay.style.display = 'none';
    // Load default file
    await loadAndSchedule(MIDI_FILES[0]);
    startRaf();
  });

  // Demo button: load Bach, colour on, hyperbolic off, fullscreen, autoplay
  document.getElementById('btn-demo').addEventListener('click', async (e) => {
    e.stopPropagation();
    // Fullscreen must be requested synchronously within the user gesture
    document.documentElement.requestFullscreen().catch(() => {});
    await audio.initAudio();
    state.audioReady = true;
    overlay.style.display = 'none';
    // Enable colour mode and ensure hyperbolic is off before loading
    state.colorMode = true;
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function scheduleWithTempo() {
  const s = state.tempoScale;
  const scaled = state.allNotes.map(n => ({ ...n, time: n.time / s, duration: n.duration / s }));
  audio.scheduleNotes(scaled);
}

// ── Load & schedule ───────────────────────────────────────────────────────────
async function loadAndSchedule(descriptor) {
  let buf;
  try {
    if (descriptor.type === 'generated') {
      buf = generateMidi(descriptor.generator);
    } else if (descriptor.type === 'buffer') {
      buf = descriptor.buffer;
    } else {
      buf = await loadMidiFile(descriptor.path);
    }
  } catch (err) {
    console.error('MIDI load error:', err);
    return;
  }

  let parsed;
  try {
    parsed = parseMidi(buf);
  } catch (err) {
    console.error('MIDI parse error:', err);
    return;
  }

  state.allNotes        = parsed.allNotes;
  state.tonicMidi       = parsed.tonicMidi;
  state.originalDuration = parsed.duration;
  state.duration        = parsed.duration / state.tempoScale;
  state.keyName         = parsed.keyName;

  ui.setKeyDisplay(state.keyName);
  ui.setProgress(0, state.duration);
  ui.setTimeDisplay(0, state.duration);

  if (state.audioReady) {
    scheduleWithTempo();
  }
  ui.setPlayButton('▶ Play');
}

// ── Transport controls ────────────────────────────────────────────────────────
function handlePlayPause() {
  if (!state.audioReady) return '▶ Play';

  const s = audio.getState();
  if (s === 'started') {
    audio.pause();
    return '▶ Play';
  } else {
    audio.play();
    return '⏸ Pause';
  }
}

function handleStop() {
  if (!state.audioReady) return;
  audio.stop();
  ui.setProgress(0, state.duration);
  ui.setTimeDisplay(0, state.duration);
}

function handleSeek(seconds) {
  if (!state.audioReady) return;
  audio.seek(seconds);
}

// ── Render loop ───────────────────────────────────────────────────────────────
function startRaf() {
  if (rafId !== null) return;

  function frame() {
    const t = state.audioReady ? audio.getTime() : 0;

    // Update progress bar and time
    if (state.duration > 0) {
      ui.setProgress(Math.min(t, state.duration), state.duration);
      ui.setTimeDisplay(t, state.duration);
    }

    // Apply visual lead: shift note lookup forward to compensate for display lag.
    // Scale back to original note times by multiplying by tempoScale.
    const tLook = (t + state.visualLeadMs / 1000) * state.tempoScale;

    // Active notes (queried at lead-adjusted, tempo-scaled time)
    const active = getActiveNotes(state.allNotes, tLook);
    ui.setNotesDisplay(active);

    // Sync measurement: time the render call
    const syncT0 = state.syncMeasure ? performance.now() : 0;

    // Visual (use tLook so drift phase is consistent with note selection)
    render(active, {
      showVisual:  state.showVisual,
      sfScale:     state.sfScale,
      waveform:    state.waveform,
      superMode:   state.superMode,
      renderMode:  state.renderMode,
      hyperbolic:  state.hyperbolic,
      colorMode:   state.colorMode,
      tilt:        state.tilt,
    });

    // Sync measurement: record render duration
    if (state.syncMeasure) {
      updateSyncDisplay(performance.now() - syncT0);
    }

    // Auto-stop detection
    if (state.audioReady && audio.getState() === 'started' && t >= state.duration && state.duration > 0) {
      audio.stop();
      ui.setPlayButton('▶ Play');
    }

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
}
