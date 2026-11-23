// Starts the app: settings, the journal, the bottom navigation and the page router.
// Pages live at #/ (timeline), #/entry/<id>, #/new, #/edit/<id>, #/calendar,
// #/search, #/more, #/import, #/bin.

import * as journal from './journal.js';
import { h, icon } from './ui.js';
import { applySettings } from './settings.js';

const routes = {
  '': () => import('./views/timeline.js'),
  entry: () => import('./views/entry.js'),
  new: () => import('./views/editor.js'),
  edit: () => import('./views/editor.js'),
  calendar: () => import('./views/calendar.js'),
  search: () => import('./views/search.js'),
  more: () => import('./views/more.js'),
  import: () => import('./views/import.js'),
  bin: () => import('./views/bin.js')
};

const main = document.querySelector('main');
let cleanup = null;

// A page can block leaving (e.g. unsaved changes in the editor).
let leaveGuard = null;
export const setLeaveGuard = fn => { leaveGuard = fn; };

async function render() {
  const [name = '', ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const load = routes[name] || routes[''];
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null; leaveGuard = null;
  const view = await load();
  main.replaceChildren();
  cleanup = await view.default(main, { name, args });
  updateNav(name);
  window.scrollTo(0, 0);
  main.querySelector('h1')?.focus?.({ preventScroll: true });
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  if (leaveGuard && !leaveGuard()) {           // stay put: restore the old address without re-rendering
    history.replaceState(null, '', lastHash || '#/');
    return;
  }
  lastHash = location.hash;
  render();
});
window.addEventListener('beforeunload', e => { if (leaveGuard && !leaveGuard(true)) e.preventDefault(); });

function nav() {
  const item = (href, name, label, cls) => h('a', { href, class: cls, dataset: { nav: name } }, icon(name === '' ? 'timeline' : name === 'new' ? 'plus' : name), cls ? h('span', { class: 'visually-hidden' }, label) : h('span', {}, label));
  return h('nav', { class: 'nav', 'aria-label': 'Main' },
    item('#/', '', 'Journal'),
    item('#/calendar', 'calendar', 'Calendar'),
    item('#/new', 'new', 'New entry', 'new'),
    item('#/search', 'search', 'Search'),
    item('#/more', 'more', 'More'));
}
function updateNav(name) {
  const group = { entry: '', edit: '', import: 'more', bin: 'more' }[name] ?? name;
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.nav === group && group !== 'new') a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

(async function start() {
  await applySettings();
  document.body.append(nav());
  try { await journal.load(); }
  catch (e) { main.replaceChildren(h('p', { class: 'empty' }, 'The journal could not be opened on this phone: ' + e.message)); return; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
})();
