# Songbook design study

Run `npm start` from the repository, then open:

http://127.0.0.1:3000/design-preview/index.html

The study offers Folio, Studio and Pebble, each in light and dark mode, plus a
390 px phone preview. The URL remembers the selected direction, mode and device
so a particular combination can be bookmarked. “Open full size” opens that
appearance without the study controls.

The sample reuses Songbook's existing stylesheet, sheet renderer, chord explorer,
chord popover and tuner. Its library and edits are held only in memory. It does
not load app.js, IndexedDB, Supabase or the service worker. Reloading restores
the original sample library. Microphone follow mode is not included in the study.

Pebble has been selected for the production application. Its styles live in
`../themes/pebble.css`, and the app now offers only Light and Dark. These studies
remain available as a record of the alternative directions.

Files:
- index.html, preview.css, preview.js: design study controls and responsive frame
- songbook.html: copy of the app's relevant markup, with sample appearance controls
- themes.css: three candidates and their two color modes
- folio-paper.css: layered-paper refinement of Folio
- paper-grain.svg, paper-grain-soft.svg: local, seamless grain and fibre textures
- sample.js: in-memory sample library and interactive preview controls

No build step or external font/image request is required.
