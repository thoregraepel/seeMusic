// DOM wiring — called once from app.js after all modules are ready.

export function setupUI({
  midiFiles,
  audioFiles,
  onSelect,
  onAudioSelect,
  onCustomFile,
  onAudioFile,
  onPlay,
  onStop,
  onSeek,
  onAudioToggle,
  onVisualToggle,
  onSfScale,
  onWaveform,
  onSuperMode,
  onRenderMode,
  onTilt,
  onHyperbolic,
  onColorMode,
  onColorWheel,
  onGridArms,
  onGridPhase,
  onSyncMeasureToggle,
  onVisualLead,
  onTempoScale,
  onFftThreshold,
  onFftTopN,
  onFftLowMidi,
  onFftHighMidi,
  onFftGain,
  onFftSmoothing,
  onFftThresholdTilt,
  onMicToggle,
  onLiveMode,
  onPianoToggle,
  onAudioMidiFile,
  onAudioMidiToggle,
  onTranscribe,
  onKeyHueRotate,
  onKeyDirectionFlip,
  onKeyDefaults,
  onQwertyToggle,
  onPhaseTauMs,
  onPhaseTau2Ms,
  onPhaseTrailSec,
  onPhaseStride,
  onPhaseLpAlpha,
  onPhasePointSize,
  onPhaseColorScheme,
  onPhaseMode3d,
  onPhaseColorMode,
  onPhaseAutoTau,
  onPhaseLines,
  onPhaseAutocam,
  onSynthPlayback,
  onPhaseSynthSource,
  onPhaseReset,
}) {
  const fileSelect      = document.getElementById('file-select');
  const audioSelect     = document.getElementById('audio-select');
  const fileInput       = document.getElementById('file-input');
  const audioInput      = document.getElementById('audio-input');
  const btnPlay         = document.getElementById('btn-play');
  const btnStop         = document.getElementById('btn-stop');
  const btnAudio        = document.getElementById('btn-audio');
  const btnVisual       = document.getElementById('btn-visual');
  const progress        = document.getElementById('progress');
  const sfSlider        = document.getElementById('sf-scale');
  const sfDisplay       = document.getElementById('sf-scale-display');
  const waveformSelect  = document.getElementById('waveform-select');
  const superSelect     = document.getElementById('super-select');

  // Populate MIDI file selector
  midiFiles.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = f.name;
    fileSelect.appendChild(opt);
  });

  fileSelect.addEventListener('change', () => onSelect(Number(fileSelect.value)));

  // Populate preloaded audio selector
  const audioPlaceholder = document.createElement('option');
  audioPlaceholder.value = '';
  audioPlaceholder.textContent = 'Preloaded audio…';
  audioPlaceholder.disabled = true;
  audioPlaceholder.selected = true;
  audioSelect.appendChild(audioPlaceholder);
  audioFiles.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = f.name;
    audioSelect.appendChild(opt);
  });
  audioSelect.addEventListener('change', () => {
    const idx = Number(audioSelect.value);
    onAudioSelect(idx);
    // Keep showing the selected name — don't reset to placeholder
  });

  // Load custom MIDI file
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => onCustomFile(e.target.result, file.name);
    reader.readAsArrayBuffer(file);
  });

  // Load audio file (MP3 / WAV / OGG etc.)
  audioInput.addEventListener('change', () => {
    const file = audioInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => onAudioFile(e.target.result, file.name);
    reader.readAsArrayBuffer(file);
  });

  // Transcribe loaded audio to MIDI using Basic Pitch (in-browser)
  const btnTranscribe = document.getElementById('btn-transcribe');
  btnTranscribe.addEventListener('click', () => onTranscribe());

  // Pair a MIDI file with the currently loaded audio (for MIDI-driven visualisation)
  const midiPairInput = document.getElementById('midi-pair-input');
  const btnMidiVis    = document.getElementById('btn-midi-vis');

  midiPairInput.addEventListener('change', () => {
    const file = midiPairInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => onAudioMidiFile(e.target.result, file.name);
    reader.readAsArrayBuffer(file);
  });

  btnMidiVis.addEventListener('click', () => {
    const active = onAudioMidiToggle();
    btnMidiVis.textContent = active ? 'MIDI Vis: ON' : 'MIDI Vis: OFF';
    btnMidiVis.classList.toggle('active', active);
  });

  // ── Mobile panel ──────────────────────────────────────────────────────────
  const headerEl        = document.querySelector('header');
  const mobileBackdrop  = document.getElementById('mobile-backdrop');
  const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
  const mobilePlayBtn   = document.getElementById('mobile-play-btn');
  const mobileStopBtn   = document.getElementById('mobile-stop-btn');

  function openPanel() {
    headerEl.classList.add('panel-open');
    mobileBackdrop.classList.add('visible');
    mobileSettingsBtn.textContent = '✕';
  }
  function closePanel() {
    headerEl.classList.remove('panel-open');
    mobileBackdrop.classList.remove('visible');
    mobileSettingsBtn.textContent = '⚙';
  }

  mobileSettingsBtn.addEventListener('click', () =>
    headerEl.classList.contains('panel-open') ? closePanel() : openPanel());
  mobileBackdrop.addEventListener('click', closePanel);
  document.getElementById('mobile-exit-fs').addEventListener('click', () => setPseudoFullscreen(false));

  function syncPlayLabel(label) {
    btnPlay.textContent = label;
    mobilePlayBtn.textContent = label.includes('⏸') ? '⏸' : '▶';
  }

  mobilePlayBtn.addEventListener('click', () => syncPlayLabel(onPlay()));
  mobileStopBtn.addEventListener('click', () => { onStop(); syncPlayLabel('▶ Play'); });

  // ── Desktop transport ──────────────────────────────────────────────────────
  btnPlay.addEventListener('click', () => { btnPlay.textContent = onPlay(); });
  btnStop.addEventListener('click', () => { onStop(); btnPlay.textContent = '▶ Play'; });
  progress.addEventListener('input', () => onSeek(Number(progress.value)));

  btnAudio.addEventListener('click', () => {
    const active = onAudioToggle();
    btnAudio.textContent = active ? 'Audio: ON' : 'Audio: OFF';
    btnAudio.classList.toggle('active', active);
  });

  btnVisual.addEventListener('click', () => {
    const active = onVisualToggle();
    btnVisual.textContent = active ? 'Visual: ON' : 'Visual: OFF';
    btnVisual.classList.toggle('active', active);
  });

  // SF scale — log2 mapping
  sfSlider.addEventListener('input', () => {
    const v = Math.pow(2, Number(sfSlider.value));
    sfDisplay.textContent = v.toFixed(2) + '×';
    onSfScale(v);
  });

  waveformSelect.addEventListener('change', () => onWaveform(waveformSelect.value));
  superSelect.addEventListener('change',    () => onSuperMode(superSelect.value));
  const rowPhase       = document.getElementById('row-phase');
  const phaseContainer = document.getElementById('phase-container');
  const gratingCanvas  = document.getElementById('grating-canvas');

  document.getElementById('render-mode-select').addEventListener('change', e => {
    const mode    = e.target.value;
    const isPhase = mode === 'phase';
    rowPhase.classList.toggle('hidden', !isPhase);
    phaseContainer.classList.toggle('hidden', !isPhase);
    gratingCanvas.classList.toggle('hidden',  isPhase);
    onRenderMode(mode);
  });

  // ── Phase-space controls ───────────────────────────────────────────────────
  const phaseTauSlider  = document.getElementById('phase-tau');
  const phaseTauDisplay = document.getElementById('phase-tau-display');
  phaseTauSlider.addEventListener('input', () => {
    const v = parseFloat(phaseTauSlider.value);
    phaseTauDisplay.textContent = `${v.toFixed(1)} ms`;
    onPhaseTauMs(v);
  });

  const phaseTau2Slider  = document.getElementById('phase-tau2');
  const phaseTau2Display = document.getElementById('phase-tau2-display');
  phaseTau2Slider.addEventListener('input', () => {
    const v = parseFloat(phaseTau2Slider.value);
    phaseTau2Display.textContent = `${v.toFixed(1)} ms`;
    onPhaseTau2Ms(v);
  });

  const btnAutoTau = document.getElementById('btn-phase-autotau');
  btnAutoTau.addEventListener('click', () => {
    const active = onPhaseAutoTau();
    btnAutoTau.textContent = active ? 'Auto τ: ON' : 'Auto τ: OFF';
    btnAutoTau.classList.toggle('active', active);
    phaseTauSlider.disabled  = active;
    phaseTau2Slider.disabled = active;
  });

  const phaseTrailSlider  = document.getElementById('phase-trail');
  const phaseTrailDisplay = document.getElementById('phase-trail-display');
  phaseTrailSlider.addEventListener('input', () => {
    const v = parseFloat(phaseTrailSlider.value);
    phaseTrailDisplay.textContent = `${v.toFixed(1)} s`;
    onPhaseTrailSec(v);
  });

  const phaseStrideSlider  = document.getElementById('phase-stride');
  const phaseStrideDisplay = document.getElementById('phase-stride-display');
  phaseStrideSlider.addEventListener('input', () => {
    const v = parseInt(phaseStrideSlider.value);
    phaseStrideDisplay.textContent = v;
    onPhaseStride(v);
  });

  const phaseLpSlider  = document.getElementById('phase-lp');
  const phaseLpDisplay = document.getElementById('phase-lp-display');
  phaseLpSlider.addEventListener('input', () => {
    const v = parseFloat(phaseLpSlider.value);
    phaseLpDisplay.textContent = `α=${v.toFixed(1)}`;
    onPhaseLpAlpha(v);
  });

  const phaseSizeSlider  = document.getElementById('phase-size');
  const phaseSizeDisplay = document.getElementById('phase-size-display');
  phaseSizeSlider.addEventListener('input', () => {
    const v = parseFloat(phaseSizeSlider.value);
    phaseSizeDisplay.textContent = v.toFixed(1);
    onPhasePointSize(v);
  });

  document.getElementById('phase-color').addEventListener('change', e => {
    onPhaseColorScheme(e.target.value);
  });

  const btnPhase3d = document.getElementById('btn-phase-3d');
  btnPhase3d.addEventListener('click', () => {
    const active = onPhaseMode3d();
    btnPhase3d.textContent = active ? '3D: ON' : '2D';
    btnPhase3d.classList.toggle('active', active);
  });

  const btnPhaseColorMode = document.getElementById('btn-phase-color-mode');
  btnPhaseColorMode.addEventListener('click', () => {
    const mode = onPhaseColorMode();
    btnPhaseColorMode.textContent = mode === 'pitch' ? 'Colors: Pitch' : 'Colors: Age';
    btnPhaseColorMode.classList.toggle('active', mode === 'pitch');
  });

  const btnPhaseLines = document.getElementById('btn-phase-lines');
  btnPhaseLines.addEventListener('click', () => {
    const active = onPhaseLines();
    btnPhaseLines.textContent = active ? 'Lines: ON' : 'Lines: OFF';
    btnPhaseLines.classList.toggle('active', active);
  });

  const btnAutocam = document.getElementById('btn-phase-autocam');
  btnAutocam.addEventListener('click', () => {
    const active = onPhaseAutocam();
    btnAutocam.textContent = active ? 'Autocam: ON' : 'Autocam: OFF';
    btnAutocam.classList.toggle('active', active);
  });

  const btnSynthPlay = document.getElementById('btn-synth-playback');
  btnSynthPlay.addEventListener('click', async () => {
    const active = await onSynthPlayback();
    btnSynthPlay.textContent = active ? 'Hear: Synth' : 'Hear: Audio';
    btnSynthPlay.classList.toggle('active', active);
  });

  const btnPhaseSource = document.getElementById('btn-phase-source');
  btnPhaseSource.addEventListener('click', async () => {
    const active = await onPhaseSynthSource();
    btnPhaseSource.textContent = active ? 'Phase: Synth' : 'Phase: Audio';
    btnPhaseSource.classList.toggle('active', active);
  });

  document.getElementById('btn-phase-reset').addEventListener('click', () => onPhaseReset());

  const gridArmsSlider  = document.getElementById('grid-arms');
  const gridArmsDisplay = document.getElementById('grid-arms-display');
  gridArmsSlider.addEventListener('input', () => {
    const v = Number(gridArmsSlider.value);
    gridArmsDisplay.textContent = v;
    onGridArms(v);
  });

  const gridPhaseSlider  = document.getElementById('grid-phase');
  const gridPhaseDisplay = document.getElementById('grid-phase-display');
  gridPhaseSlider.addEventListener('input', () => {
    const v = Number(gridPhaseSlider.value);
    gridPhaseDisplay.textContent = `${v}°`;
    onGridPhase(v);
  });

  const tiltSlider  = document.getElementById('tilt');
  const tiltDisplay = document.getElementById('tilt-display');
  tiltSlider.addEventListener('input', () => {
    const v = Number(tiltSlider.value);
    tiltDisplay.textContent = v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
    onTilt(v);
  });

  const btnColor = document.getElementById('btn-color');
  btnColor.addEventListener('click', () => {
    const active = onColorMode();
    btnColor.textContent = active ? 'Color: ON' : 'Color: OFF';
    btnColor.classList.toggle('active', active);
  });

  document.getElementById('btn-color-wheel').addEventListener('click', () => onColorWheel());

  const btnHyp = document.getElementById('btn-hyp');
  btnHyp.addEventListener('click', () => {
    const active = onHyperbolic();
    btnHyp.textContent = active ? 'Hyp: ON' : 'Hyp: OFF';
    btnHyp.classList.toggle('active', active);
  });

  const tempoSlider  = document.getElementById('tempo');
  const tempoDisplay = document.getElementById('tempo-display');
  tempoSlider.addEventListener('input', () => {
    const v = Math.pow(2, Number(tempoSlider.value));
    tempoDisplay.textContent = v.toFixed(2) + '×';
    onTempoScale(v);
  });

  const fftSlider  = document.getElementById('fft-threshold');
  const fftDisplay = document.getElementById('fft-threshold-display');
  fftSlider.addEventListener('input', () => {
    const db = Number(fftSlider.value);
    fftDisplay.textContent = `${db} dB`;
    onFftThreshold(db);
  });

  const topNSlider  = document.getElementById('fft-top-n');
  const topNDisplay = document.getElementById('fft-top-n-display');
  topNSlider.addEventListener('input', () => {
    const n = Number(topNSlider.value);
    topNDisplay.textContent = n;
    onFftTopN(n);
  });


  const gainSlider  = document.getElementById('fft-gain');
  const gainDisplay = document.getElementById('fft-gain-display');
  gainSlider.addEventListener('input', () => {
    const v = Math.pow(2, Number(gainSlider.value));
    gainDisplay.textContent = v.toFixed(1) + '×';
    onFftGain(v);
  });

  const smoothSlider  = document.getElementById('fft-smoothing');
  const smoothDisplay = document.getElementById('fft-smoothing-display');
  smoothSlider.addEventListener('input', () => {
    const v = Number(smoothSlider.value);
    smoothDisplay.textContent = v.toFixed(2);
    onFftSmoothing(v);
  });

  const threshTiltSlider  = document.getElementById('fft-thresh-tilt');
  const threshTiltDisplay = document.getElementById('fft-thresh-tilt-display');
  threshTiltSlider.addEventListener('input', () => {
    const v = Number(threshTiltSlider.value);
    threshTiltDisplay.textContent = (v >= 0 ? '+' : '') + v.toFixed(1);
    onFftThresholdTilt(v);
  });

  const visualLeadSlider  = document.getElementById('visual-lead');
  const visualLeadDisplay = document.getElementById('visual-lead-display');
  visualLeadSlider.addEventListener('input', () => {
    const ms = Number(visualLeadSlider.value);
    visualLeadDisplay.textContent = `${ms} ms`;
    onVisualLead(ms);
  });

  const btnSync = document.getElementById('btn-sync');
  const syncPanel = document.getElementById('sync-panel');
  btnSync.addEventListener('click', () => {
    const active = onSyncMeasureToggle();
    btnSync.textContent = active ? 'Sync: ON' : 'Sync: OFF';
    btnSync.classList.toggle('active', active);
    if (syncPanel) syncPanel.classList.toggle('visible', active);
  });

  const btnPiano = document.getElementById('btn-piano');
  btnPiano.addEventListener('click', () => {
    const active = onPianoToggle();
    btnPiano.textContent = active ? 'Piano: ON' : 'Piano: OFF';
    btnPiano.classList.toggle('active', active);
  });

  let qwertyActive = false;

  const btnKeys = document.getElementById('btn-keys');
  btnKeys.addEventListener('click', () => {
    const { enabled, octave } = onQwertyToggle();
    qwertyActive = enabled;
    btnKeys.textContent = enabled ? `Keys: C${octave}` : 'Keys: OFF';
    btnKeys.classList.toggle('active', enabled);
  });

  const btnLive = document.getElementById('btn-live');
  btnLive.addEventListener('click', async () => {
    const active = await onLiveMode();
    btnLive.textContent = active ? 'Live: ON' : 'Live: OFF';
    btnLive.classList.toggle('active', active);
  });

  const btnFullscreen = document.getElementById('btn-fullscreen');

  function setPseudoFullscreen(on) {
    document.body.classList.toggle('app-fullscreen', on);
    btnFullscreen.textContent = on ? '✕ Exit Full' : '⛶ Fullscreen';
    btnFullscreen.classList.toggle('active', on);
  }

  btnFullscreen.addEventListener('click', () => {
    // CSS pseudo-fullscreen: fills the browser window without triggering a
    // macOS Space switch. Press Escape or click the button again to exit.
    const willBeOn = !document.body.classList.contains('app-fullscreen');
    setPseudoFullscreen(willBeOn);
  });

  // Keep button in sync if native fullscreen is triggered another way (e.g. F11)
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) setPseudoFullscreen(true);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('app-fullscreen')) {
      setPseudoFullscreen(false);
    }
  });

  const btnMic = document.getElementById('btn-mic');
  btnMic.addEventListener('click', () => {
    const active = onMicToggle();
    btnMic.classList.toggle('active', active);
    btnMic.textContent = active ? '🎤 Mic: ON' : '🎤 Mic';
  });

  // About modal
  const aboutModal = document.getElementById('about-modal');
  document.getElementById('btn-about').addEventListener('click', () => aboutModal.classList.add('visible'));
  document.getElementById('about-close').addEventListener('click', () => aboutModal.classList.remove('visible'));
  aboutModal.addEventListener('click', e => { if (e.target === aboutModal) aboutModal.classList.remove('visible'); });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    switch (e.code) {
      case 'Space': e.preventDefault(); btnPlay.click(); break;
      case 'KeyA':  btnAudio.click();      break;
      case 'KeyV':  if (!qwertyActive) btnVisual.click(); break;
      case 'KeyF':  btnFullscreen.click(); break;

      // 0 → circles
      case 'Digit0':
        e.preventDefault();
        document.getElementById('render-mode-select').value = 'circles';
        onRenderMode('circles');
        break;

      // 1–9 → grid with N arms
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
      case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': {
        if (qwertyActive) break;
        e.preventDefault();
        const arms = Number(e.key);
        document.getElementById('render-mode-select').value = 'grid';
        onRenderMode('grid');
        gridArmsSlider.value = arms;
        gridArmsDisplay.textContent = arms;
        onGridArms(arms);
        break;
      }

      // ↑ / ↓ → SF Scale zoom in / out
      case 'ArrowUp': {
        e.preventDefault();
        const nextUp = Math.min(parseFloat(sfSlider.max),
          parseFloat(sfSlider.value) + parseFloat(sfSlider.step));
        sfSlider.value = nextUp;
        const vUp = Math.pow(2, nextUp);
        sfDisplay.textContent = vUp.toFixed(2) + '×';
        onSfScale(vUp);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        const nextDn = Math.max(parseFloat(sfSlider.min),
          parseFloat(sfSlider.value) - parseFloat(sfSlider.step));
        sfSlider.value = nextDn;
        const vDn = Math.pow(2, nextDn);
        sfDisplay.textContent = vDn.toFixed(2) + '×';
        onSfScale(vDn);
        break;
      }

      // ← / → → rotate colour wheel one semitone
      case 'ArrowLeft':
        e.preventDefault();
        onKeyHueRotate(-30);
        break;
      case 'ArrowRight':
        e.preventDefault();
        onKeyHueRotate(30);
        break;

      // - / + → phase rotation
      case 'Minus': case 'NumpadSubtract': {
        e.preventDefault();
        const pDn = ((parseInt(gridPhaseSlider.value) - 15) % 360 + 360) % 360;
        gridPhaseSlider.value = pDn;
        gridPhaseDisplay.textContent = `${pDn}°`;
        onGridPhase(pDn);
        break;
      }
      case 'Equal': case 'NumpadAdd': {
        e.preventDefault();
        const pUp = (parseInt(gridPhaseSlider.value) + 15) % 360;
        gridPhaseSlider.value = pUp;
        gridPhaseDisplay.textContent = `${pUp}°`;
        onGridPhase(pUp);
        break;
      }

      // Enter → flip CW / CCW
      case 'Enter':
        e.preventDefault();
        onKeyDirectionFlip();
        break;

      // D → reset visual settings to defaults
      case 'KeyD': {
        if (qwertyActive) break;
        e.preventDefault();
        const renderSel = document.getElementById('render-mode-select');
        sfSlider.value = 0;           sfDisplay.textContent = '1.00×';  onSfScale(1);
        waveformSelect.value = 'sawtooth';                               onWaveform('sawtooth');
        renderSel.value = 'circles';                                     onRenderMode('circles');
        gridArmsSlider.value = 2;     gridArmsDisplay.textContent = '2'; onGridArms(2);
        gridPhaseSlider.value = 0;    gridPhaseDisplay.textContent = '0°'; onGridPhase(0);
        superSelect.value = 'sum';                                       onSuperMode('sum');
        tiltSlider.value = 0;         tiltDisplay.textContent = '0.0';   onTilt(0);
        onKeyDefaults();  // resets colorMode, hyperbolic, hue offset/direction + dial
        break;
      }
    }
  });

  return {
    setProgress(value, max)      { progress.max = max; progress.value = value; },
    setTimeDisplay(current, total) {
      document.getElementById('time-display').textContent = `${fmt(current)} / ${fmt(total)}`;
    },
    setKeyDisplay(keyName)       { document.getElementById('key-display').textContent = `Key: ${keyName}`; },
    setNotesDisplay(notes) {
      const top5 = notes.slice(0, 5);
      document.getElementById('notes-display').textContent =
        top5.length ? `Notes: ${top5.map(n => midiToName(n.midi)).join(' ')}${notes.length > 5 ? ' …' : ''}` : 'Notes: —';
    },
    setPlayButton(label)  { btnPlay.textContent = label; mobilePlayBtn.textContent = label.includes('⏸') ? '⏸' : '▶'; },
    setColorMode(active)  { btnColor.textContent = active ? 'Color: ON' : 'Color: OFF'; btnColor.classList.toggle('active', active); },
    setHyperbolic(active) { btnHyp.textContent   = active ? 'Hyp: ON'   : 'Hyp: OFF';   btnHyp.classList.toggle('active', active); },
    setModeIndicator(mode) {
      const text = mode === 'audio' ? '🎵 AUDIO' : mode === 'mic' ? '🎤 MIC' : '🎹 MIDI';
      const el = document.getElementById('mode-indicator');
      if (el) { el.textContent = text; el.dataset.mode = mode; }
      const pill = document.getElementById('mobile-mode-pill');
      if (pill) { pill.textContent = text; pill.dataset.mode = mode; }
    },
    setNoteRange(_low, _high) {},  // range is set via piano keyboard only
    setLoadedFile(name) {
      const el = document.getElementById('loaded-file');
      if (el) el.textContent = name || '';
    },
    setMidiStatus(names, error) {
      const el = document.getElementById('midi-status');
      if (!el) return;
      if (error) {
        el.textContent = `MIDI: ${error}`;
        el.className = 'midi-error';
      } else if (!names || names.length === 0) {
        el.textContent = '';
        el.className = '';
      } else {
        el.textContent = `MIDI: ${names.join(', ')}`;
        el.className = 'midi-active';
      }
    },
    setPhaseTau(v) {
      phaseTauSlider.value      = Math.max(parseFloat(phaseTauSlider.min),
                                  Math.min(parseFloat(phaseTauSlider.max), v));
      phaseTauDisplay.textContent = `${v.toFixed(1)} ms`;
    },
    setPhaseTau2(v) {
      phaseTau2Slider.value      = Math.max(parseFloat(phaseTau2Slider.min),
                                   Math.min(parseFloat(phaseTau2Slider.max), v));
      phaseTau2Display.textContent = `${v.toFixed(1)} ms`;
    },
    setLpCutoffDisplay(hz) {
      if (!hz || !isFinite(hz)) return;
      const alpha = parseFloat(phaseLpSlider.value);
      const txt = hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
      phaseLpDisplay.textContent = `α=${alpha.toFixed(1)} → ${txt}Hz`;
    },
    setQwertyOctave(oct) {
      if (!qwertyActive) return;
      btnKeys.textContent = `Keys: C${oct}`;
    },
    setLiveMode(active) {
      btnLive.textContent = active ? 'Live: ON' : 'Live: OFF';
      btnLive.classList.toggle('active', active);
    },
    setAudioMidiVis(active, available) {
      btnMidiVis.disabled = !available;
      btnMidiVis.textContent = active ? 'MIDI Vis: ON' : 'MIDI Vis: OFF';
      btnMidiVis.classList.toggle('active', active);
    },
    setTranscribeButton(label, disabled) {
      btnTranscribe.textContent = label;
      btnTranscribe.disabled    = disabled;
    },
  };
}

function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

const NOTE_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
function midiToName(midi) { return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1); }
