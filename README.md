# Lyrics & Chords Library

A small local app for storing, editing, searching, and displaying lyric/chord sheets.

## Run Locally

```sh
npm start
```

Open `http://127.0.0.1:3000`.

The app also runs as a static PWA from the `public/` folder, which is what GitHub Pages uses.

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
- Look up any chord from the **Chords** button in the header, with every voicing
  shown at once, and optional inversions and shapes with muted inner strings
- Copy the stored chord sheet
- Import from Ultimate Guitar URLs when the page HTML is accessible

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
