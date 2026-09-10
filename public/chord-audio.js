import { STANDARD_TUNING } from './chord-voicings.js';
let context;
let active = [];
let generation = 0;
export function stopChordAudio() {
  generation += 1;
  for (const oscillator of active) { try { oscillator.stop(); } catch {} }
  active = [];
}
export async function playChordVoicing(voicing) {
  return playChordSequence([voicing]);
}

/* Plays voicings one after another, so an approach can be heard resolving into
   the chord it leads to rather than a chord at a time. */
export async function playChordSequence(voicings, gap = .85) {
  stopChordAudio();
  const request = generation;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error('Audio preview is unavailable in this browser.');
  context ||= new AudioContext();
  await context.resume();
  if (request !== generation) return;
  const now = context.currentTime;
  const playable = voicings.filter(Boolean);
  const last = playable.length - 1;
  playable.forEach((voicing, at) => schedule(voicing, now + at * gap, at === last ? 1.5 : gap + .35));
}

function schedule(voicing, at, hold) {
  voicing.frets.forEach((fret, string) => {
    if (fret === null || fret < 0) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = at + string * .025;
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((STANDARD_TUNING[string] + fret - 69) / 12);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(.045, start+.012);
    gain.gain.exponentialRampToValueAtTime(.001, start+hold-.1);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(start); oscillator.stop(start+hold);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); active = active.filter(item => item !== oscillator); };
    active.push(oscillator);
  });
}
