const directions = {
  folio: ['01 / Folio', 'Visible paper grain, contrasting card stock and overlapping menus.'],
  studio: ['02 / Studio', 'Satin panels, crisp typography and controls with a little weight.'],
  pebble: ['03 / Pebble', 'Ceramic surfaces, softened corners and a quiet sage accent.']
};
const query = new URLSearchParams(location.search);
let design = Object.hasOwn(directions, query.get('design')) ? query.get('design') : 'folio';
let mode = query.get('mode') === 'dark' ? 'dark' : 'light';
let device = query.get('device') === 'phone' ? 'phone' : 'desktop';
const frame = document.querySelector('iframe');
function update() {
  for (const [key, value] of Object.entries({design, mode, device})) {
    document.querySelectorAll(`[data-${key}]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset[key] === value)));
  }
  document.querySelector('#currentName').textContent = directions[design][0];
  document.querySelector('#currentDescription').textContent = directions[design][1];
  document.querySelector('#previewStage').classList.toggle('phone', device === 'phone');
  const url = `songbook.html?design=${design}&mode=${mode}`;
  document.querySelector('#openPreview').href = url;
  frame.title = `Interactive ${design} design preview in ${mode} mode`;
  frame.contentWindow.postMessage({type:'songbook-design', design, mode}, location.origin);
  history.replaceState(null, '', `?design=${design}&mode=${mode}&device=${device}`);
}
document.querySelectorAll('[data-design]').forEach(button => button.addEventListener('click', () => {design = button.dataset.design; update();}));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {mode = button.dataset.mode; update();}));
document.querySelectorAll('[data-device]').forEach(button => button.addEventListener('click', () => {device = button.dataset.device; update();}));
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'songbook-preview-ready') update();
  if (event.data?.type === 'songbook-mode' && ['light','dark'].includes(event.data.mode)) {mode = event.data.mode; update();}
});
update();
