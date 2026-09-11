# Lyrics & Chords Library

A small local app for storing, editing, searching, and displaying lyric/chord sheets.

## Run Locally

```sh
npm start
```

Open `http://127.0.0.1:3000`.

The app also runs as a static PWA from the `public/` folder, which is what GitHub Pages uses.

## Appearance

Songbook uses Pebble, with **Light** and **Dark** choices under **Settings and
syncing → Appearance**. The choice is saved on this device. Existing Stage Mode
users stay in dark mode; other legacy themes become light. New installations
start with the system appearance.

### Colours

**Settings and syncing → Colours** takes a **Main** and an **Accent** colour.
Main tints the surfaces, accent colours the controls, chord names and diagrams.
One pair of choices covers both light and dark, and the app re-tints as the
picker moves. **Reset colours** returns to Pebble.

Only the hue of each choice is used. Every token keeps the lightness Pebble was
designed with, so body text holds at least 7:1 against its surfaces and the
accent at least 4.5:1 whatever colours are chosen; `tests/palette.test.js`
holds those floors across the hue wheel in both modes. Saturation follows the
choice up to a ceiling, so surfaces stay a tint rather than a wash, and colours
outside the sRGB gamut lose chroma rather than hue.

The choice lives on the device alongside the light/dark mode, so it is not part
of a Supabase sync or a JSON backup.

## Features

- Store songs locally in browser IndexedDB
- Optional Supabase sync for cross-device storage
- Export and import JSON backups of the local library
- Add and edit songs manually
- Search title, artist, lyrics, chords, and tags
- Display Ultimate Guitar-style `[ch]G[/ch]` chord markup with chords aligned above lyrics
- Transpose chords in the viewer without changing the saved original
- Hover a chord (or tap it on a phone) to see how to play it, and step through
  voicings from the open shape up the neck
- Open the harmony panel on any chord to explore extensions, borrowed chords,
  substitutions from elsewhere in the key and chords that change where the
  progression goes; filter by how far each reaches, hear it between its
  neighbours, and replace that occurrence
- Choose a main and accent colour under **Settings and syncing → Colours**
- Hover or click a chord for a small window with its shapes, and step through
  the voicings there without anything else opening
- Its **Re-harmonize** button opens the harmony panel, which stays open: on a
  wide screen it docks down the right and the sheet reflows beside it, so you
  can scroll the song and click through its chords with the panel holding still
- Look up any chord from the **Chords** button in the header, with every voicing
  shown at once, and optional inversions and shapes with muted inner strings
- Tune by ear from the **Tuner** panel in the sidebar, which plays the six
  concert pitches of standard tuning (E2 A2 D3 G3 B3 E4, A4 = 440 Hz)
- Copy the stored chord sheet
- Import from Ultimate Guitar URLs when the page HTML is accessible

## Reharmonizing a song

Click or tap a chord, then turn on **Re-harmonize**. Alternatives range from
gentler additions (sevenths, ninths, sixths) through altered dominants, raised
elevenths, suspensions and raised fifths, to borrowed chords, substitutions drawn
from elsewhere in the key, tritone substitutions and chords that change where the
progression is heading. Each choice explains its effect and shows shared, added
and removed chord tones. Suggestions are harmonic possibilities; the app does not
analyze the melody or guarantee a substitution will fit it, however much harmonic
context it has.

### What the suggestions know

The panel reads the chord either side of the one you clicked, and the key of the
song as a whole.

Neighbours come from inside the same section, so the chord after a verse's last
is not the chorus's first. The header shows the run you are sitting in, and the
chord's function when there is one, as in `Dm7 → G7 → C · V7 in C major`.

The key is inferred from the song's chords, how often each is used, and how they
resolve into each other. Cadences carry the most weight and the closing cadence
carries the most of all, because counting chord membership alone cannot separate
a key from its relative: they share every diatonic chord. Relative major and
minor that both get visited are settled by where the music actually lands.

A song that leans on nothing is left unnamed rather than guessed at: no function
is shown and no function-dependent suggestion is offered. This is chord-progression
analysis and nothing to do with the tune.

`tests/fixtures/keys.js` holds the songs the scoring weights answer to, each with
the key a musician would give it, or marked as one the inference must refuse. The
weights were tuned against the whole set rather than against any one song, and
the confidence floor sits in the gap between the two bands, which
`tests/song-key.test.js` checks has not closed.

Where the chord either side makes a shape worth naming, the header says so:
`Dm7 → G7 → Cmaj7 · V7 in C major · ii–V–I`. It recognises a two-five-one, a
dominant sidestepping to the sixth degree instead of resolving, a chord repeated,
and a dominant of whatever follows. Inside a two-five-one the tritone substitute
explains itself as the bass walk it makes, `D → Db → C`, rather than in general
terms.

Each of those shapes also asks for something different, and offers it. A chord
played twice is the clearest case: it is asking for movement, so it is offered
the same chord over its own third or fifth, where the bass moves and the
harmony holds, and the line cliché that walks an inner voice while the root
stays put. Where the next chord is the point of the bar, which is what the
other shapes have in common, the diminished a semitone under it is offered to
lean up into it: inside a two-five-one that is the dominant without its root,
and on a deceptive cadence it turns the sidestep into an arrival. A dominant of
whatever follows can also be stepped through rather than arrived on, by putting
the target's second degree where its dominant was.

With a key in hand, each suggestion is labelled with its degree and whether it
sits inside the key, and a second set of suggestions becomes available: the ones
that come from what the chord is *doing* rather than from what it is.

A chord read on its own carries no function to substitute for, so without a key
the panel can only offer the same root dressed differently. The degree does carry
one, and two rules cover most of what players reach for. The key's own chords a
third above and a third below share two of the three notes, so either stands in
for this one without argument: on the tonic of C major that is `Em7` and `Am7`,
on the fourth degree `Am7` and `Dm7`. And the same degree taken from the parallel
mode is the whole borrowed-chord vocabulary in one rule, giving `i`, `iiø`,
`bIII`, `iv`, `v`, `bVI` and `bVII` on the degrees of a major key.

The borrowing only runs both ways where it is idiomatic. A major key borrows from
its parallel minor freely; a minor key borrowing back from major is really only
two chords, the raised third of a Picardy close and the raised sixth that makes
the fourth degree major, so the other degrees are left alone rather than offered
for the sake of symmetry.

Three chromatic options are offered where the key can place them: a flat seventh
on the tonic and on the fourth, the blues and gospel colours that fall outside the
major scale; a backdoor dominant where the tonic is the chord that follows; and a
Neapolitan on the degrees that set up the dominant.

A suggestion whose name is underlined with dots introduces a **cross relation**
with a neighbour: the same letter in two chromatic forms a beat apart, C against
C sharp, or E against E flat. An ordinary semitone between successive chords is
not flagged, since a fourth chord resolving to the tonic moves F to E and that is
the plainest voice leading there is.

Suggestions are ordered gentler first, matching the tint ramp, with anything that
introduces a cross relation last inside its band. Where nothing separates two
suggestions the written order stands, so the list stays recognisable.

A row of chips above the list cuts it to the bands you want, each carrying its
own count. Clicking a band while everything is showing narrows to that band
alone, which is the move being reached for on a phone; after that the chips
toggle, so two bands can be read together, and turning the last one off means
all again rather than an empty list. The choice carries across chords, because
narrowing to the bold end is a way of reading a whole song rather than a
decision about one chord. **All** is the default, so a docked panel with room
for the lot still shows the lot.

Hovering a chord shows a small window with its shape, the arrows for stepping
through voicings, and one small **Re-harmonize** button. Clicking a chord holds
that window open so the shapes can be stepped through without the panel in the
way, and hovering elsewhere no longer pulls it off the chord being looked at.
Clicking away dismisses it.

The button is the only thing that opens the panel. Looking up a shape and
reaching for harmony are different jobs, and the smaller one should not drag the
larger one open.

Once the panel is open it stays open until the close button dismisses it. Clicking elsewhere on the sheet does not close it, so the
song can be scrolled and its chords clicked through while the panel holds still.
Applying a chord leaves the panel on that same chord.

On a window at least 1000px wide with a mouse or trackpad the panel docks down
the right and the song column is padded clear of it, so the two never overlap.
Narrower than that, or on a touch screen, it is a bottom sheet instead.
Resizing across that width switches presentation without losing the panel.

The docked column is full height with a single scroll, which is why the whole
list of suggestions fits without a scrollbar of its own. As a bottom sheet the
list is capped and scrolls inside itself, and fades out over its last rows
wherever there is more underneath: a scrollbar that appears only once you are
already scrolling cannot tell you whether anything is down there.

The panel is the reharmonize view, so it opens showing its suggestions rather
than a button that offers them. A small **Hide** beside the context line stands
them down and gives the whole width to one chord shape; **Show** brings them
back. That choice outlives the chord being looked at, since collapsing it once
and having it spring back on the next chord would not be a preference at all.

While the panel is open, hovering another chord does not open a preview over it:
a window following the mouse would keep pulling attention off the chord being
worked on. Clicking another chord moves the panel to it, as before.

Select a suggestion to inspect its guitar shapes and hear it where it sits. The
audio row is laid out as the bar is: the chord before on the left, the chord
after on the right, and the middle holding the chord as written over whatever
has been picked for it, with the columns named underneath. Hearing a suggestion
on its own says how it sounds; hearing it between its neighbours says whether it
works. Audio uses a synthesized standard-tuning voicing without capo.
**Use this chord** changes only that occurrence and marks it with a dotted underline.
Transpose continues to work on the arrangement. Reopen the chord to **Restore
original chord**, or use **Reset chords** to clear all replacements for the song.

Each suggestion carries a deepening accent tint for how far the change reaches,
in four bands: untinted only adds notes, a mild tint substitutes something that
stays inside the key, a firm tint reaches outside it, and a firm tint with a left
edge changes where the progression goes. The words are in each row's tooltip and
accessible name, so the colour is a shortcut rather than the only carrier.

How far a change reaches is measured against the song's key, not against the
chord in isolation, and against the chord it replaces rather than against the
scale alone. So a raised eleventh is a chromatic reach over the tonic and plain
lydian colour over the fourth degree, where every note of it is already in the
key. And a chord already sitting outside the key is not charged again for staying
there: `bIII` in a major key is outside it whatever you do, so extending it is
still only extending it. Without a confident key there is nothing to measure
against, and the bands fall back to what the suggestion does to the chord: adding
notes, changing its quality, or moving its root.

Drafts stay available while switching songs in the current tab, but are cleared on
reload or when the underlying sheet changes. **Copy** includes the draft; **Save new
version** opens a prefilled new-song form so you can name and keep the arrangement
without overwriting the original. Copies and saved versions retain the original
key and capo, independent of the viewer's transpose setting.

### Leads into this chord

A closed section at the foot of the panel shows ways into the chord rather than
ways to replace it: its dominant, the two-five that steps through that dominant,
a chord a semitone above sliding down, and a diminished a semitone below leaning
up. Selecting one plays it resolving into the chord, and says when the song
already does that.

Nothing here is added to the sheet, which is a deliberate limit. Chords are
positioned by the character column they sit above and the app stores no note
lengths, so it cannot know whether a passing chord takes half a bar or one beat
of it. It shows the idea and leaves the placement to your ear.

The substitution vocabulary draws on [Open Music Theory's discussion of jazz
substitutions](https://viva.pressbooks.pub/openmusictheory/chapter/substitutions/).

## GitHub Pages

This app is ready to host as a static GitHub Pages site from the `public/` folder.

Recommended Pages settings:

1. Push this repository to GitHub
2. In GitHub, open **Settings > Pages**
3. Set **Source** to GitHub Actions, or publish the `public/` folder from a Pages workflow
4. Add your final Pages URL to Supabase Auth redirect URLs

For this repository, the expected project Pages URL is:

```text
https://maxwellriess.github.io/Songbook/
```

## Ultimate Guitar and GuitarTuna Import

The hosted PWA does not server-scrape chord sites. Use the browser extension clipper instead:

1. Open a tab on `tabs.ultimate-guitar.com`, `ultimate-guitar.com` or `guitartuna.com`
2. Click **Songbook Clipper**
3. Keep the app URL as `https://maxwellriess.github.io/Songbook`
4. Click **Clip current tab**

The extension saves the clipped song into Songbook's IndexedDB storage and syncs it to Supabase when you are signed in.

Manual entry still accepts Ultimate Guitar chord markup such as:

```text
[Verse]
[ch]G[/ch]Amazing [ch]C[/ch]grace, how [ch]G[/ch]sweet the sound
```

## Browser Extension Clipper

The `extension/` folder contains a Chrome/Edge-compatible Manifest V3 extension that clips a manually loaded Ultimate Guitar or GuitarTuna page into this local app.

Install it locally:

1. Start the app with `npm start`
2. Open Chrome or Edge
3. Go to `chrome://extensions` or `edge://extensions`
4. Turn on developer mode
5. Choose **Load unpacked**
6. Select the `extension/` folder

Use it:

1. Open a tab on `tabs.ultimate-guitar.com`, `ultimate-guitar.com` or `guitartuna.com`
2. Let the page load normally in your browser
3. Click the **Songbook Clipper** extension button
4. Use `https://maxwellriess.github.io/Songbook` for the hosted PWA, or `http://127.0.0.1:3000` for local development
5. Click **Clip current tab**

On Ultimate Guitar the extension first tries to read the embedded page data. Ultimate Guitar's own scripts strip that data from the page once it loads, so the extension re-reads the page's server HTML to recover it. Failing that, it reads the song details from the page's schema.org JSON-LD and falls back to visible chord-sheet text.

GuitarTuna renders a song as a beat grid rather than a chord sheet, so the extension reads the grid instead. Every lyric line is a row of beat cells, each declaring how many characters it spans, so adding up the cells before a chord gives the column that chord sits above. The extension rebuilds a plain chords-over-lyrics sheet from those columns and takes the title, artist, key, capo and tuning from the page's schema.org JSON-LD.

## Supabase Sync

The app can sync songs and playlists to a Supabase project using an emailed sign-in code. IndexedDB storage still works without Supabase.

Set up Supabase:

1. Create a Supabase project
2. Open the SQL editor
3. Run `supabase/schema.sql`
4. In **Project Settings > API Keys**, copy the project URL and the **publishable** key (`sb_publishable_...`)
5. In **Authentication > URL Configuration**, add your app URL to the redirect URLs
6. In **Authentication > Emails**, open the **Magic Link** template and add `{{ .Token }}` to it, for example `<p>Your Songbook sign-in code is {{ .Token }}</p>`

Step 6 is easy to miss and blocks sign-in completely. Supabase's default Magic Link template contains only a link, no code, so without `{{ .Token }}` the email never shows the 6-digit code this app asks for, sign-in can never finish, and nothing ever syncs.

Projects created before November 2025 show a legacy **anon** key instead of a publishable key. Either works here: Supabase deprecated the anon key rather than removing it, and both go in the same field. Projects created from November 2025 onwards only have publishable keys.

If playlists already existed before playlist sync was added, run the latest `supabase/schema.sql` again. It migrates playlist IDs and playlist song IDs to text columns so older local IDs can sync safely.

Use sync:

1. Open Songbook
2. Click **Sync > Settings**
3. Paste the project URL and publishable key, then click **Save settings**
4. Enter your email and click **Send code**
5. Enter the 6-digit code from the email and click **Verify code**
6. Click **Sync**

Signing in with the code rather than the emailed link means an installed PWA signs in without the link needing to open in the same browser. The link in the same email still works if you open it in the browser running the app.

Sync uploads the whole local library on the first successful sign-in, so the Supabase tables stay empty until sign-in completes. Empty tables usually mean sign-in never finished, not that data was lost.

The tables use Row Level Security policies so signed-in users can only read and write their own songs and playlists.

The publishable key (like the legacy anon key) is safe to use in the browser when Row Level Security is enabled. Do not paste a secret or service-role key into the app; it bypasses Row Level Security, and the settings dialog rejects it.

## Backup

Use **Export** in the library sidebar to download a JSON backup of the songs stored in this browser. Use **Import** to merge a backup into the local library; newer versions replace older matching songs.

## Test

```sh
npm test
```
