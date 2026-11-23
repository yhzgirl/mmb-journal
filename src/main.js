// Starts the app: settings, the journal, the bottom navigation and the page router.
// Pages live at #/ (timeline), #/entry/<id>, #/new, #/edit/<id>, #/calendar,
// #/search, #/more, #/import, #/bin.

import * as journal from './journal.js';
import { h, icon } from './ui.js';
import { applySettings } from './settings.js';
import { startLock, ui as lockUi } from './lock.js';
import * as sync from './sync.js';
import * as dbx from './dropbox.js';
import { openRecoveryBlock, keyId } from './crypto.js';
import { toast } from './ui.js';

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

// ---------- a new phone: start a journal, or restore one from Dropbox ----------

async function welcome() {
  let problem = null;
  try {
    const back = await dbx.finishSignIn();
    if (back?.purpose === 'restore') {
      const r = await restoreFrom(back.auth);
      if (r?.restored) return r;
      problem = r?.problem || null;
    }
  } catch (e) { problem = e.message; }
  return new Promise(resolve => {
    const p = lockUi.panel();
    p.body.append(h('div', { class: 'pin forgot welcome' },
      h('h1', {}, 'Welcome to MMB Journal'),
      problem ? h('p', { class: 'pin-msg error' }, problem) : null,
      h('p', { class: 'lock-note' }, 'Your journal is kept on this phone and, once you connect it, in your Dropbox. It\'s encrypted in both places, and only your PIN, your fingerprint or your recovery key can open it.'),
      h('button', { type: 'button', class: 'btn', onclick: () => { p.close(); resolve(null); } }, 'Start a new journal'),
      h('button', { type: 'button', class: 'btn secondary', onclick: () => dbx.startSignIn('restore') }, 'Restore from Dropbox'),
      h('p', { class: 'lock-note small' }, 'To restore, you\'ll need the recovery key you saved when you set up the journal.')));
  });
}

async function restoreFrom(auth) {
  dbx.useAuth(auth);
  const wait = lockUi.panel();
  wait.body.append(h('div', { class: 'pin' }, h('h1', {}, 'Looking in your Dropbox…')));
  let rj;
  try { rj = await dbx.downloadJson('/journal.json'); }
  catch (e) { return { problem: e.message }; }
  finally { wait.close(); }
  if (!rj?.encryption?.recovery) return { problem: 'There\'s no MMB Journal in this Dropbox yet. Start a new journal, then connect Dropbox from More.' };
  const raw = await new Promise(resolve => {
    const p = lockUi.panel();
    p.body.append(lockUi.recoveryForm({
      heading: 'Restore from Dropbox', button: 'Restore my journal',
      note: 'Type the recovery key for the journal in your Dropbox.',
      open: async text => {
        const r = await openRecoveryBlock(rj.encryption.recovery, text);
        if (await keyId(r) !== rj.encryption.keyId) throw new Error('That recovery key doesn\'t match the journal in Dropbox.');
        p.close(); resolve(r);
      },
      below: h('button', { type: 'button', class: 'lock-link', onclick: () => { p.close(); resolve(null); } }, 'Start a new journal instead')
    }));
  });
  if (!raw) return null;
  const pin = await lockUi.chooseNewPin({ heading: 'Choose a PIN for this phone', cancellable: false });
  return { restored: true, pin, raw, recovery: rj.encryption.recovery, auth };
}

// ---------- sync progress, shown above the navigation ----------

function syncPill() {
  const el = h('div', { class: 'sync-pill', role: 'status', 'aria-live': 'polite', hidden: true });
  const words = { download: 'Getting entries from Dropbox', photos: 'Getting photos from Dropbox', upload: 'Saving to Dropbox' };
  sync.onStatus(s => {
    const p = s.progress;
    const show = p && words[p.phase] && p.total > 2;
    el.hidden = !show;
    if (show) el.textContent = `${words[p.phase]}: ${p.done + 1} of ${p.total}`;
  });
  return el;
}

(async function start() {
  await applySettings();
  let pendingAuth = null;
  // The PIN comes before anything from the journal is shown.
  await startLock({ welcome: async () => { const r = await welcome(); if (r?.auth) pendingAuth = r.auth; return r; } });

  // Back from connecting Dropbox in More?
  let connectedNow = false, signInProblem = null;
  try { const back = await dbx.finishSignIn(); if (back) { pendingAuth = back.auth; connectedNow = true; } }
  catch (e) { signInProblem = e.message; }

  document.body.append(syncPill(), nav());
  await sync.init({ onPulled: () => { if (!/^#\/(new|edit)/.test(location.hash)) render(); } });
  if (pendingAuth) await dbx.saveAuth(pendingAuth);
  try { await journal.load(); }
  catch (e) { main.replaceChildren(h('p', { class: 'empty' }, 'The journal could not be opened on this phone: ' + e.message)); return; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (connectedNow) { history.replaceState(null, '', '#/more'); lastHash = '#/more'; toast('Dropbox connected. Saving your journal there now.'); sync.connected(); }
  else if (signInProblem) { history.replaceState(null, '', '#/more'); lastHash = '#/more'; toast(signInProblem); }
  else sync.syncNow();
  render();
})();
