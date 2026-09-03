/* Reference-pitch tuner.

   No microphone and no pitch detection: this just plays the six concert
   pitches of standard tuning so you can tune by ear against them. One pitch
   sounds at a time and holds until you stop it, which is what you want while
   turning a machine head. */

const A4_MIDI = 69;
const DEFAULT_A4 = 440;

/* Low string first, the way the strings sit under your hand. */
export const STANDARD_TUNING = [
  { string: 6, note: "E", octave: 2, midi: 40 },
  { string: 5, note: "A", octave: 2, midi: 45 },
  { string: 4, note: "D", octave: 3, midi: 50 },
  { string: 3, note: "G", octave: 3, midi: 55 },
  { string: 2, note: "B", octave: 3, midi: 59 },
  { string: 1, note: "E", octave: 4, midi: 64 }
];

export function noteFrequency(midi, a4 = DEFAULT_A4) {
  return a4 * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function tuningPitches(a4 = DEFAULT_A4) {
  return STANDARD_TUNING.map((entry) => ({
    ...entry,
    label: `${entry.note}${entry.octave}`,
    frequency: noteFrequency(entry.midi, a4)
  }));
}

export function formatFrequency(frequency) {
  return `${frequency.toFixed(2)} Hz`;
}

/* Harmonic amplitudes for a warm, string-like tone. The fundamental stays
   dominant so the pitch is easy to hear against a real string. */
const HARMONICS = [0, 1, 0.5, 0.32, 0.16, 0.1, 0.06, 0.04, 0.025, 0.015];
const PEAK_GAIN = 0.18;
const ATTACK = 0.04;
const RELEASE = 0.12;

let elements = null;
let pitches = tuningPitches();
let context = null;
let wave = null;
let voice = null;

export function initTuner() {
  const container = document.querySelector("#tunerStrings");
  const status = document.querySelector("#tunerStatus");
  if (!container || !status) return;

  elements = { container, status, buttons: new Map() };

  for (const pitch of pitches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tuner-string";
    button.dataset.string = String(pitch.string);
    button.setAttribute("aria-pressed", "false");
    button.title = `${pitch.label} · ${formatFrequency(pitch.frequency)}`;

    const note = document.createElement("span");
    note.className = "tuner-string-note";
    note.textContent = pitch.note;

    const octave = document.createElement("span");
    octave.className = "tuner-string-octave";
    octave.textContent = String(pitch.octave);

    button.append(note, octave);
    button.addEventListener("click", () => toggle(pitch));
    container.append(button);
    elements.buttons.set(pitch.string, button);
  }

  /* A forgotten drone in a backgrounded tab helps nobody. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });

  render();
}

function toggle(pitch) {
  if (voice && voice.string === pitch.string) {
    stop();
    return;
  }
  play(pitch);
}

function play(pitch) {
  stop();

  const audio = getContext();
  if (!audio) {
    elements.status.textContent = "This browser cannot play tones.";
    return;
  }
  if (audio.state === "suspended") audio.resume();

  const oscillator = audio.createOscillator();
  oscillator.setPeriodicWave(getWave(audio));
  oscillator.frequency.value = pitch.frequency;

  const gain = audio.createGain();
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, now + ATTACK);

  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);

  voice = { oscillator, gain, string: pitch.string, pitch };
  render();
}

function stop() {
  if (!voice) return;

  const { oscillator, gain } = voice;
  const audio = context;
  const now = audio.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + RELEASE);
  oscillator.stop(now + RELEASE + 0.02);

  voice = null;
  render();
}

function render() {
  if (!elements) return;

  for (const [string, button] of elements.buttons) {
    const active = Boolean(voice) && voice.string === string;
    button.classList.toggle("is-playing", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }

  elements.status.textContent = voice
    ? `Playing ${voice.pitch.label} · ${formatFrequency(voice.pitch.frequency)} · tap again to stop`
    : "Tap a string to hear its pitch.";
}

function getContext() {
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

function getWave(audio) {
  if (wave) return wave;
  const real = new Float32Array(HARMONICS.length);
  const imag = Float32Array.from(HARMONICS);
  wave = audio.createPeriodicWave(real, imag, { disableNormalization: false });
  return wave;
}
