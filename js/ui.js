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
    audioSelect.value = '';  // reset to placeholder so re-selecting same item works
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
  document.getElementById('render-mode-select').addEventListener('change', e => onRenderMode(e.target.value));

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
      case 'KeyV':  btnVisual.click();     break;
      case 'KeyF':  btnFullscreen.click(); break;
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
    setLiveMode(active) {
      btnLive.textContent = active ? 'Live: ON' : 'Live: OFF';
      btnLive.classList.toggle('active', active);
    },
  };
}

function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

const NOTE_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
function midiToName(midi) { return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1); }
