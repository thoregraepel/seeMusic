// DOM wiring — called once from app.js after all modules are ready.

export function setupUI({
  midiFiles,
  onSelect,
  onCustomFile,
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
  onSyncMeasureToggle,
  onVisualLead,
}) {
  const fileSelect      = document.getElementById('file-select');
  const fileInput       = document.getElementById('file-input');
  const btnPlay         = document.getElementById('btn-play');
  const btnStop         = document.getElementById('btn-stop');
  const btnAudio        = document.getElementById('btn-audio');
  const btnVisual       = document.getElementById('btn-visual');
  const progress        = document.getElementById('progress');
  const sfSlider        = document.getElementById('sf-scale');
  const sfDisplay       = document.getElementById('sf-scale-display');
  const waveformSelect  = document.getElementById('waveform-select');
  const superSelect     = document.getElementById('super-select');

  // Populate file selector
  midiFiles.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = f.name;
    fileSelect.appendChild(opt);
  });

  fileSelect.addEventListener('change', () => onSelect(Number(fileSelect.value)));

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => onCustomFile(e.target.result, file.name);
    reader.readAsArrayBuffer(file);
  });

  btnPlay.addEventListener('click', () => {
    const label = onPlay();
    btnPlay.textContent = label;
  });

  btnStop.addEventListener('click', () => {
    onStop();
    btnPlay.textContent = '▶ Play';
  });

  progress.addEventListener('input', () => {
    onSeek(Number(progress.value));
  });

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


  // SF scale slider — log2 mapping: sfScale = 2^sliderValue
  sfSlider.addEventListener('input', () => {
    const sfScale = Math.pow(2, Number(sfSlider.value));
    sfDisplay.textContent = sfScale.toFixed(2) + '×';
    onSfScale(sfScale);
  });

  waveformSelect.addEventListener('change', () => onWaveform(waveformSelect.value));
  superSelect.addEventListener('change',    () => onSuperMode(superSelect.value));
  document.getElementById('render-mode-select').addEventListener('change', e => onRenderMode(e.target.value));

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

  const btnFullscreen = document.getElementById('btn-fullscreen');
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    btnFullscreen.textContent = isFs ? '✕ Exit Full' : '⛶ Fullscreen';
    btnFullscreen.classList.toggle('active', isFs);
  });

  // About modal
  const aboutModal = document.getElementById('about-modal');
  document.getElementById('btn-about').addEventListener('click', () => {
    aboutModal.classList.add('visible');
  });
  document.getElementById('about-close').addEventListener('click', () => {
    aboutModal.classList.remove('visible');
  });
  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) aboutModal.classList.remove('visible');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    switch (e.code) {
      case 'Space': e.preventDefault(); btnPlay.click(); break;
      case 'KeyA':  btnAudio.click();       break;
      case 'KeyV':  btnVisual.click();      break;
      case 'KeyF':  btnFullscreen.click();  break;
    }
  });

  return {
    setProgress(value, max) {
      progress.max   = max;
      progress.value = value;
    },
    setTimeDisplay(current, total) {
      document.getElementById('time-display').textContent =
        `${fmt(current)} / ${fmt(total)}`;
    },
    setKeyDisplay(keyName) {
      document.getElementById('key-display').textContent = `Key: ${keyName}`;
    },
    setNotesDisplay(notes) {
      document.getElementById('notes-display').textContent =
        notes.length
          ? `Notes: ${notes.map(n => midiToName(n.midi)).join(' ')}`
          : 'Notes: —';
    },
    setPlayButton(label) {
      btnPlay.textContent = label;
    },
    setColorMode(active) {
      btnColor.textContent = active ? 'Color: ON' : 'Color: OFF';
      btnColor.classList.toggle('active', active);
    },
    setHyperbolic(active) {
      btnHyp.textContent = active ? 'Hyp: ON' : 'Hyp: OFF';
      btnHyp.classList.toggle('active', active);
    },
  };
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

const NOTE_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
}
