// Deliberately in-memory: this study never opens the real library database or sync client.
import { renderSheet } from '../song-renderer.js';
import { buildMetaPills } from '../song-model.js';
import { initChordPopover, closeChordPopover } from '../chord-popover.js';
import { initChordExplorer, collectSongChords } from '../chord-explorer.js';
import { initTuner } from '../tuner.js';
const $ = id => document.getElementById(id);
const titles = [
  ['The open road', 'A Sunday afternoon', 'G'],
  ['Small hours', 'Kitchen table sessions', 'G'],
  ['A place by the water', 'A Sunday afternoon', 'G'],
  ['Home before the rain', 'Field recordings', 'G'],
  ['Juniper', 'Kitchen table sessions', 'G'],
  ['Slow morning', 'Field recordings', 'G']
];
// Original sample lyrics, shared by all six previews.
const verses = [
  ['Leave the window open, let the morning in', 'There is a road beyond the garden wall', 'Take the old guitar and a little time', 'We have nowhere else to be at all'],
  ['Light across the table, shadows on the floor', 'A quiet house before the day begins', 'Let the coffee settle, leave another hour', 'Listen as the morning wanders in'],
  ['Find a little shelter by the waterline', 'Watch the silver ripples drift away', 'Every small reflection has a light to keep', 'Every open doorway has a day']
];
let songs = titles.map(([title,artist,key],i) => ({id:String(i),title,artist,key,capo:i%2?'2':'',tuning:'Standard tuning',tags:['Acoustic'],rawContent:`[Verse 1]\n[ch]G[/ch]${verses[i%3][0]}\n[ch]C[/ch]${verses[i%3][1]}\n[ch]Em[/ch]${verses[i%3][2]}\n[ch]D[/ch]${verses[i%3][3]}\n\n[Chorus]\n[ch]C[/ch]Take your time, the [ch]G[/ch]day is only starting\n[ch]Em[/ch]Let the light fall [ch]D[/ch]softly where we are\n[ch]C[/ch]Every mile is [ch]G[/ch]something worth remembering\n[ch]Am[/ch]Every song can [ch]D[/ch]carry us that far\n\n[Verse 2]\n[ch]G[/ch]Fold the map and leave it on the table\n[ch]C[/ch]Keep a little space for something new\n[ch]Em[/ch]All the things we thought we had to hurry\n[ch]D[/ch]Can wait until the afternoon is through` }));
let selected = songs[0], transpose = 0, size = 16, view = 'recent', query = '', editing = null;
const playlist = new Set(['0','2','5']);
let scrollFrame = null, lastTime = 0, scrolling = false, scrollRemainder = 0;
const media = matchMedia('(max-width:820px)');
function sidebar(collapsed) {
  $('appShell').classList.toggle('sidebar-collapsed', collapsed);
  $('sidebarToggle').setAttribute('aria-expanded', String(!collapsed));
}
sidebar(media.matches);
media.addEventListener('change', () => sidebar(media.matches));
$('sidebarToggle').onclick = () => sidebar(!$('appShell').classList.contains('sidebar-collapsed'));
$('sidebarScrim').onclick = () => sidebar(true);
function notice(text) {
  $('toast').textContent = text; $('toast').classList.add('visible');
  clearTimeout(notice.timer); notice.timer = setTimeout(() => $('toast').classList.remove('visible'), 2600);
}
function list() {
  $('songCount').textContent = `${songs.length} songs · sample library`;
  $('songList').replaceChildren();
  let filtered = songs.filter(s => [s.title,s.artist,s.rawContent,...s.tags].join(' ').toLowerCase().includes(query));
  if (view === 'playlists') filtered = filtered.filter(s => playlist.has(s.id));
  if (view === 'artists') filtered.sort((a,b) => a.artist.localeCompare(b.artist));
  let artist = '';
  for (const song of filtered) {
    if (view === 'artists' && song.artist !== artist) {
      const heading = document.createElement('p'); heading.className = 'section-label'; heading.textContent = song.artist;
      $('songList').append(heading); artist = song.artist;
    }
    const button = document.createElement('button'); button.className = `song-row${song.id === selected?.id ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(song.id === selected?.id));
    const title = document.createElement('strong'); title.textContent = song.title;
    const subtitle = document.createElement('span'); subtitle.textContent = song.artist;
    button.append(title, subtitle);
    button.onclick = () => {selected = song; transpose = 0; stop(); render(); if (media.matches) sidebar(true);};
    $('songList').append(button);
  }
  if (!filtered.length) {const empty = document.createElement('p');empty.className='list-empty';empty.textContent='No songs found.';$('songList').append(empty);}
}
function sheet() {
  closeChordPopover();
  $('viewer').replaceChildren();
  if (selected) {
    const paper = document.createElement('div');paper.className = 'sheet';paper.style.setProperty('--sheet-font-size', `${size}px`);
    paper.append(renderSheet(selected, transpose));$('viewer').append(paper);
  } else {$('viewer').textContent = 'Create a sample song to try this view.';}
  $('transposeValue').textContent = transpose > 0 ? `+${transpose}` : transpose;
  $('fontSizeValue').textContent = size;
  $('transposeDown').disabled = transpose <= -6 || !selected;
  $('transposeUp').disabled = transpose >= 6 || !selected;
  $('fontSizeDown').disabled = size <= 13;
  $('fontSizeUp').disabled = size >= 24;
}
function render() {
  list();$('songTitle').textContent = selected?.title || 'Your songbook';$('artistMeta').textContent = selected?.artist || 'No song selected';
  $('songMeta').replaceChildren(...(selected ? buildMetaPills(selected) : []));
  $('viewer').classList.toggle('empty-state', !selected);
  ['editButton','deleteButton','copyButton','headerPlaylistMenuButton','autoscrollToggle'].forEach(id => $(id).disabled = !selected);
  $('headerPlaylistMenuButton').textContent = playlist.has(selected?.id) ? 'In Sunday set ✓' : 'Add to Sunday set';
  $('viewer').scrollTop = 0;sheet();
}
$('searchInput').oninput = event => {query = event.target.value.trim().toLowerCase();list();};
document.querySelectorAll('[data-library-view]').forEach(button => button.onclick = () => {
  view = button.dataset.libraryView;
  document.querySelectorAll('[data-library-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  $('libraryViewControls').textContent = view === 'playlists' ? 'Sunday set' : view === 'artists' ? 'By artist' : 'All songs';list();
});
$('libraryViewControls').textContent = 'All songs';
$('transposeDown').onclick = () => {transpose = Math.max(-6, transpose-1);sheet();};
$('transposeUp').onclick = () => {transpose = Math.min(6, transpose+1);sheet();};
$('fontSizeDown').onclick = () => {size = Math.max(13, size-1);sheet();};
$('fontSizeUp').onclick = () => {size = Math.min(24, size+1);sheet();};
$('headerPlaylistMenuButton').removeAttribute('aria-haspopup');
$('headerPlaylistMenuButton').removeAttribute('aria-expanded');
$('headerPlaylistMenuButton').onclick = () => {if (playlist.has(selected.id)) playlist.delete(selected.id); else playlist.add(selected.id);render();};
$('copyButton').onclick = async () => {try {await navigator.clipboard.writeText(`${selected.title}\n${$('viewer').innerText}`);notice('Sample sheet copied');}catch {notice('Clipboard unavailable in this preview');}};
function edit(song) {
  editing = song;
  $('dialogTitle').textContent = song ? 'Edit sample song' : 'New sample song';
  for (const field of ['title','artist','key','capo','tuning']) $(`${field}Input`).value = song?.[field] || '';
  $('tagsInput').value = song?.tags.join(', ') || '';$('contentInput').value = song?.rawContent || '';$('songDialog').showModal();
}
$('editButton').onclick = () => edit(selected);$('newSongButton').onclick = () => edit(null);
$('closeDialogButton').onclick = $('cancelButton').onclick = () => $('songDialog').close();
$('songForm').onsubmit = event => {
  event.preventDefault();
  const song = {id:editing?.id || crypto.randomUUID()};
  for (const field of ['title','artist','key','capo','tuning']) song[field] = $(`${field}Input`).value.trim();
  song.tags = $('tagsInput').value.split(',').map(s => s.trim()).filter(Boolean);song.rawContent = $('contentInput').value;
  if (editing) songs = songs.map(s => s.id === song.id ? song : s);else songs.push(song);
  selected = song;$('songDialog').close();render();notice('Updated in this preview only');
};
$('deleteButton').onclick = () => {songs = songs.filter(s => s.id !== selected.id);selected = songs[0];stop();render();notice('Sample removed. Reload to reset the library.');};
function speed() {return Math.round(8 + 92 * ($('autoscrollSpeed').value / 100)**2);}
$('autoscrollSpeed').oninput = () => $('autoscrollSpeedValue').textContent = `${speed()} px/s`;
$('autoscrollSpeed').oninput();
function stop() {scrolling = false;cancelAnimationFrame(scrollFrame);$('autoscrollToggle').textContent='Start';}
function step(time) {
  if (!scrolling) return;
  scrollRemainder += Math.min(time-lastTime, 100) / 1000 * speed();lastTime = time;
  const distance = Math.floor(scrollRemainder);
  if (distance) { $('viewer').scrollTop += distance; scrollRemainder -= distance; }
  if ($('viewer').scrollTop + $('viewer').clientHeight >= $('viewer').scrollHeight - 1) {stop();return;}
  scrollFrame = requestAnimationFrame(step);
}
$('autoscrollToggle').onclick = () => {if (scrolling) stop();else {scrolling=true;scrollRemainder=0;lastTime=performance.now();$('autoscrollToggle').textContent='Pause';scrollFrame=requestAnimationFrame(step);}};
function apply(design, mode) {
  if (['folio','studio','pebble'].includes(design)) document.documentElement.dataset.design = design;
  if (['light','dark'].includes(mode)) document.documentElement.dataset.mode = mode;
  $('modeSelect').value = document.documentElement.dataset.mode;
}
$('modeSelect').onchange = () => {apply(null,$('modeSelect').value);if(parent!==window) parent.postMessage({type:'songbook-mode',mode:$('modeSelect').value},location.origin);};
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'songbook-design') return;
  apply(event.data.design,event.data.mode);
});
apply();render();
initChordPopover($('viewer'));
initChordExplorer({getSongChords:() => collectSongChords(selected,transpose)});
initTuner();
if (parent !== window) parent.postMessage({type:'songbook-preview-ready'},location.origin);
