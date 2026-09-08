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
  stopChordAudio();
  const request = generation;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) throw new Error('Audio preview is unavailable in this browser.');
  context ||= new AudioContext();
  await context.resume();
  if (request !== generation) return;
  const now = context.currentTime;
  voicing.frets.forEach((fret, string) => {
    if (fret === null || fret < 0) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + string * .025;
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((STANDARD_TUNING[string] + fret - 69) / 12);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(.045, start+.012);
    gain.gain.exponentialRampToValueAtTime(.001, start+1.4);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(start); oscillator.stop(start+1.5);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); active = active.filter(item => item !== oscillator); };
    active.push(oscillator);
  });
}
