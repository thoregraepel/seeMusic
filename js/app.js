import { MIDI_FILES, generateMidi, loadMidiFile } from './midi_files.js';
import { parseMidi } from './midi_parser.js';
import { getActiveNotes } from './scheduler.js';
import * as audio from './audio_engine.js';
import { init as initVisual, render } from './visual_engine.js';
import { setupUI } from './ui.js';

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  allNotes:    [],
  tonicMidi:   60,
  duration:    0,
  keyName:     'C major (default)',
  showAudio:    true,
  showVisual:   true,
  audioReady:   false,
  sfScale:      1.0,    // spatial frequency multiplier (set from slider)
  waveform:     'sine', // 'sine' | 'square' | 'triangle' | 'sawtooth'
  superMode:    'sum',  // 'sum' | 'product' | 'max'
  renderMode:   'circles', // 'circles' | 'grid'
  hyperbolic:   false,
  tilt:         0,     // spectral tilt: >0 boosts highs, <0 boosts lows
  syncMeasure:  false,     // audio-visual sync measurement mode
  visualLeadMs: 22,        // ms to read ahead for note selection (compensates display lag)
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
    onSyncMeasureToggle:  () => {
      state.syncMeasure = !state.syncMeasure;
      if (state.syncMeasure) { syncRenders.length = 0; }
      return state.syncMeasure;
    },
    onVisualLead: ms => { state.visualLeadMs = ms; },
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

  startRaf();
});

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

  state.allNotes  = parsed.allNotes;
  state.tonicMidi = parsed.tonicMidi;
  state.duration  = parsed.duration;
  state.keyName   = parsed.keyName;

  ui.setKeyDisplay(state.keyName);
  ui.setProgress(0, state.duration);
  ui.setTimeDisplay(0, state.duration);

  if (state.audioReady) {
    audio.scheduleNotes(state.allNotes);
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

    // Apply visual lead: shift note lookup forward to compensate for display lag
    const tLook = t + state.visualLeadMs / 1000;

    // Active notes (queried at lead-adjusted time)
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
