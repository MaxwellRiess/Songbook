/* Songs with keys a musician would agree on, for holding the key inference to
   account. Chord progressions, not lyrics, so nothing here is anyone's writing.

   `key` is the answer the inference must reach confidently. `ambiguous: true`
   means the opposite: the progression genuinely supports more than one reading
   and the inference must hold back rather than pick one.

   `knownLimit` marks a case the current scoring gets wrong for a reason worth
   recording rather than papering over. Those are asserted as they behave, so a
   change that fixes one shows up as a failing test to update. */

export const KEY_CORPUS = [
  // ---- clear major ----
  {
    name: "Amazing Grace in G",
    chords: ["G", "C", "G", "D", "G", "Em", "D", "G", "C", "G", "D", "G"],
    key: "G major"
  },
  {
    name: "I IV V in C, landing home",
    chords: ["C", "F", "G", "C", "C", "F", "G", "C"],
    key: "C major"
  },
  {
    name: "Circle progression in D",
    chords: ["D", "A", "Bm", "F#m", "G", "D", "G", "A", "D"],
    key: "D major"
  },
  {
    name: "ii V I turnaround in Bb",
    chords: ["Cm7", "F7", "Bbmaj7", "Cm7", "F7", "Bbmaj7"],
    key: "Bb major"
  },
  {
    name: "I vi IV V doo-wop in C",
    chords: ["C", "Am", "F", "G", "C", "Am", "F", "G", "C"],
    key: "C major"
  },
  {
    name: "Jazz ii V I in F with a tritone substitute",
    chords: ["Gm7", "C7", "Fmaj7", "Gm7", "Db7", "Fmaj7", "Gm7", "C7", "Fmaj7"],
    key: "F major"
  },

  // ---- clear minor ----
  {
    name: "House of the Rising Sun in A minor",
    chords: ["Am", "C", "D", "F", "Am", "C", "E7", "Am", "Am", "C", "D", "F", "Am", "E7", "Am"],
    key: "A minor"
  },
  {
    name: "Harmonic minor cadence in E minor",
    chords: ["Em", "Am", "B7", "Em", "Em", "Am", "B7", "Em"],
    key: "E minor"
  },
  {
    name: "Andalusian cadence in A minor",
    chords: ["Am", "G", "F", "E7", "Am", "G", "F", "E7", "Am"],
    key: "A minor"
  },
  {
    name: "Greensleeves in A minor",
    chords: ["Am", "G", "Am", "E7", "Am", "G", "Am", "E7", "Am", "C", "G", "Em", "Am"],
    key: "A minor"
  },
  {
    name: "Minor blues in A minor",
    chords: ["Am7", "Dm7", "Am7", "Am7", "Dm7", "Dm7", "Am7", "Am7", "Em7", "Dm7", "Am7", "Em7", "Am7"],
    key: "A minor"
  },

  // ---- the hard middle: relative keys both visited ----
  {
    name: "I Fall In Love Too Easily",
    chords: [
      "Em7", "A7", "Dmaj7", "D6", "Em7", "A7", "Bm", "Bm7", "Em", "F#7", "Bm", "Bm7",
      "C#7", "C#m7", "F#7", "Bm", "Bm7", "C#7", "F#7", "B7", "Em",
      "Em7", "A7", "Dmaj7", "G", "A7", "D",
      "Bm", "Bm7", "C#7", "F#7", "B7", "Em", "Em7", "A7", "Dmaj7", "G", "A7", "D"
    ],
    key: "D major"
  },
  {
    name: "Leans on the relative minor but cadences home",
    chords: ["C", "Am", "C", "Am", "F", "G", "C", "Am", "F", "G", "C"],
    key: "C major"
  },

  // ---- ends away from the tonic ----
  {
    name: "Verse ending on the dominant",
    chords: ["C", "F", "C", "G", "C", "F", "C", "G"],
    key: "C major"
  },

  // ---- dominant-heavy blues, where almost nothing is diatonic ----
  {
    name: "Twelve-bar blues in A",
    chords: ["A7", "D7", "A7", "A7", "D7", "D7", "A7", "A7", "E7", "D7", "A7", "E7"],
    key: "A major"
  },

  // ---- modal ----
  {
    name: "Dorian folk tune with no sixth in the chords",
    chords: ["Dm", "C", "Dm", "F", "C", "Dm", "Am", "Dm", "C", "Dm"],
    key: "D minor"
  },

  // ---- loops that do have an answer, on reflection ----
  {
    name: "vi IV I V loop",
    chords: ["Am", "F", "C", "G"],
    /* Written down as ambiguous at first, which was wrong. A minor is never
       established here: its dominant, E or E7, never appears. C major's does,
       and so does its tonic. A musician asked what key this loop is in says
       C major, and for the same reason the scoring does. */
    key: "C major"
  },
  {
    name: "Em C G D loop",
    chords: ["Em", "C", "G", "D"],
    key: "G major"
  },

  {
    name: "Minor vamp leaning on a plagal motion",
    chords: ["Am", "Em", "Am", "Em"],
    /* Also written down as ambiguous at first, also wrong. Am to Em is iv to i
       in E minor, a real if gentle cadence, and it happens twice. Em to Am is
       v to i with a minor fifth degree, which is not a functional cadence at
       all, and is exactly why minor keys borrow a major dominant. The evidence
       leans one way. */
    key: "E minor"
  },

  // ---- must stay silent ----
  {
    name: "Two chords a relative apart, neither dominant present",
    chords: ["C", "Am", "C", "Am"],
    /* Symmetric in a way the vamp above is not: both chords are diatonic in
       both readings, neither key's dominant appears, and no motion between them
       cadences either way. The two candidates tie exactly. */
    ambiguous: true
  },

  {
    name: "Chromatic run belonging to no key",
    chords: ["C", "D", "Eb", "F#"],
    ambiguous: true
  },

  // ---- known limits ----
  {
    name: "Mixolydian vamp on G, whose chords all sit in C major",
    chords: ["G", "F", "G", "F", "C", "G", "F", "G"],
    /* G F C are I bVII IV of G mixolydian, and also V IV I of C major. Nothing
       in the chords contains the B that would separate the two, and no dominant
       resolves anywhere, so the reading that makes every chord diatonic wins.
       Telling these apart needs the melody. */
    knownLimit: "C major"
  }
];
