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
- Add and edit songs manually
- Search title, artist, lyrics, chords, and tags
- Display Ultimate Guitar-style `[ch]G[/ch]` chord markup with chords aligned above lyrics
- Transpose chords in the viewer without changing the saved original
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

## Ultimate Guitar Import

The hosted PWA does not server-scrape Ultimate Guitar pages. Use the browser extension clipper instead:

1. Open a tab on `tabs.ultimate-guitar.com` or `ultimate-guitar.com`
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

The `extension/` folder contains a Chrome/Edge-compatible Manifest V3 extension that clips a manually loaded Ultimate Guitar page into this local app.

Install it locally:

1. Start the app with `npm start`
2. Open Chrome or Edge
3. Go to `chrome://extensions` or `edge://extensions`
4. Turn on developer mode
5. Choose **Load unpacked**
6. Select the `extension/` folder

Use it:

1. Open a tab on `tabs.ultimate-guitar.com` or `ultimate-guitar.com`
2. Let the page load normally in your browser
3. Click the **Songbook Clipper** extension button
4. Use `https://maxwellriess.github.io/Songbook` for the hosted PWA, or `http://127.0.0.1:3000` for local development
5. Click **Clip current tab**

The extension first tries to read Ultimate Guitar's embedded page data. If that is unavailable, it falls back to visible chord-sheet text.

## Supabase Sync

The app can sync songs to a Supabase project using email magic-link sign-in. IndexedDB storage still works without Supabase.

Set up Supabase:

1. Create a Supabase project
2. Open the SQL editor
3. Run `supabase/schema.sql`
4. In **Project Settings > API**, copy the project URL and anon public key
5. In **Authentication > URL Configuration**, add your app URL to the redirect URLs

Use sync:

1. Open Songbook
2. Click **Sync > Settings**
3. Paste the project URL and anon key
4. Enter your email
5. Click **Send magic link**
6. Open the magic link in the same browser
7. Click **Sync**

The table uses Row Level Security policies so signed-in users can only read and write their own songs.

The Supabase anon key is safe to use in the browser when Row Level Security is enabled. Do not use a service-role key in the app.

## Test

```sh
npm test
```
