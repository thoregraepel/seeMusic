// Tone.js audio engine wrapper.
// Tone.js is loaded as a CDN global — window.Tone / Tone.*

let synth      = null;
let analyser   = null;
let synthGain  = null;   // gain node between synth and speakers
let audioMuted = false;

export async function initAudio() {
  await Tone.start();
  if (!synth) {
    // Native AnalyserNode on the Tone.js AudioContext for phase-space readout.
    // smoothingTimeConstant=0 gives the raw waveform without temporal averaging.
    analyser = Tone.context.rawContext.createAnalyser();
    analyser.fftSize               = 8192;
    analyser.smoothingTimeConstant = 0;

    // Route synth → analyser (always gets signal) and
    //        synth → synthGain → destination (can be muted independently).
    synthGain = new Tone.Gain(1).toDestination();

    synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 64,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.05, sustain: 0.85, release: 0.4 },
    }).connect(synthGain);

    synth.connect(analyser);
  }
}

export function getAnalyserNode() { return analyser; }

export function scheduleNotes(allNotes) {
  Tone.Transport.cancel();
  Tone.Transport.stop();

  for (const note of allNotes) {
    Tone.Transport.schedule((audioTime) => {
      if (synth) {
        const freq = Tone.Frequency(note.midi, 'midi').toFrequency();
        synth.triggerAttackRelease(freq, note.duration, audioTime, note.velocity);
      }
    }, note.time);
  }
}

export function play()  { Tone.Transport.start(); }
export function pause() { Tone.Transport.pause(); }
export function stop()  { Tone.Transport.stop();  }

export function seek(seconds) {
  const wasPlaying = Tone.Transport.state === 'started';
  Tone.Transport.seconds = seconds;
  // Tone.js does not re-fire already-passed scheduled events after seek,
  // so seeking only affects future events. This is acceptable behaviour.
  if (wasPlaying && Tone.Transport.state !== 'started') Tone.Transport.start();
}

export function setMuted(muted) {
  audioMuted = muted;
  if (synthGain) synthGain.gain.value = muted ? 0 : 1;
}

// Mute synth speaker output independently.
// Unlike setMuted, this does NOT affect noteOn — synth still drives the analyser.
export function setSynthSpeakerMuted(muted) {
  if (synthGain) synthGain.gain.value = muted ? 0 : 1;
}

export function getTime()  { return Tone.Transport.seconds; }
export function getState() { return Tone.Transport.state;   }

const _heldFreqs = new Map(); // midi → freq string, so noteOff uses the exact same value

export function noteOn(midi, velocity = 0.8) {
  if (!synth) return;
  const freq = Tone.Frequency(midi, 'midi').toFrequency();
  _heldFreqs.set(midi, freq);
  synth.triggerAttack(freq, Tone.now(), velocity);
}

export function noteOff(midi) {
  if (!synth) return;
  const freq = _heldFreqs.get(midi);
  if (freq === undefined) return;
  _heldFreqs.delete(midi);
  synth.triggerRelease(freq, Tone.now());
}
