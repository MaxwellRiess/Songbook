import assert from "node:assert/strict";
import test from "node:test";
import { decodeEscapes, extractUltimateGuitarData, findTabView, normalizeSong } from "../server.js";

test("extracts tab data from Ultimate Guitar js-store markup", () => {
  const payload = {
    store: {
      page: {
        data: {
          tab_view: {
            song_name: "The Parting Glass",
            artist_name: "Ed Sheeran",
            tonality_name: "D",
            capo: 2,
            tuning: { name: "Standard" },
            wiki_tab: {
              content: "[Verse]\\n[ch]D[/ch]Of all the [ch]G[/ch]money"
            }
          }
        }
      }
    }
  };
  const encoded = JSON.stringify(payload).replace(/"/g, "&quot;");
  const html = `<html><body><div class="js-store" data-content="${encoded}"></div></body></html>`;

  const tabView = findTabView(extractUltimateGuitarData(html));

  assert.equal(tabView.song_name, "The Parting Glass");
  assert.equal(tabView.artist_name, "Ed Sheeran");
  assert.equal(decodeEscapes(tabView.wiki_tab.content), "[Verse]\n[ch]D[/ch]Of all the [ch]G[/ch]money");
});

test("normalizes sparse songs without dropping raw chord markup", () => {
  const song = normalizeSong({
    title: " Test Song ",
    artist: " Artist ",
    rawContent: " [ch]G[/ch]Line "
  });

  assert.equal(song.title, "Test Song");
  assert.equal(song.artist, "Artist");
  assert.equal(song.rawContent, "[ch]G[/ch]Line");
  assert.ok(song.id);
});
