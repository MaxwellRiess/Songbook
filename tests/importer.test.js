import assert from "node:assert/strict";
import test from "node:test";
import { decodeEscapes, extractUltimateGuitarData, findTabInfo, findTabView, normalizeSong } from "../server.js";

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

test("reads song details from the tab record and meta block", () => {
  // Ultimate Guitar moved song/artist/key onto a sibling `tab` record and
  // capo/tonality/tuning into tab_view.meta.
  const payload = {
    store: {
      page: {
        data: {
          tab: {
            song_name: "Hallelujah",
            artist_name: "Jeff Buckley",
            tonality_name: "Db"
          },
          tab_view: {
            meta: {
              capo: 1,
              tonality: "Db",
              tuning: { index: 1, name: "Standard", value: "E A D G B E" }
            },
            wiki_tab: { content: "[Intro]\\n[ch]C[/ch] [ch]Am[/ch]" }
          }
        }
      }
    }
  };
  const encoded = JSON.stringify(payload).replace(/"/g, "&quot;");
  const html = `<html><body><div class="js-store" data-content="${encoded}"></div></body></html>`;

  const pageData = extractUltimateGuitarData(html);
  const tabInfo = findTabInfo(pageData);
  const tabView = findTabView(pageData);

  assert.equal(tabInfo.song_name, "Hallelujah");
  assert.equal(tabInfo.artist_name, "Jeff Buckley");
  assert.equal(tabView.meta.capo, 1);
  assert.equal(tabView.meta.tonality, "Db");
  assert.equal(tabView.meta.tuning.name, "Standard");
  assert.equal(decodeEscapes(tabView.wiki_tab.content), "[Intro]\n[ch]C[/ch] [ch]Am[/ch]");
});

test("findTabInfo ignores tab objects that carry no song name", () => {
  assert.equal(findTabInfo({ tab: { id: 5 } }), null);
  assert.equal(findTabInfo({}), null);
  assert.equal(findTabInfo(null), null);
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
