// Two-way sync between the phone and Dropbox/Apps/MMB Journal/.
//
// Dropbox holds:
//   journal.json                           plain: format, and the journal key locked by the recovery key
//   entries/<id>/entry.json.enc            each entry, encrypted
//   entries/<id>/media/<file>.enc          its photos and videos, encrypted
// The bytes are the same as on the phone (see store.js), so nothing is decrypted
// or re-encrypted to sync.
//
// Each run: check journal.json, fetch what changed in Dropbox, then send what
// changed here. If an entry was changed both here and in Dropbox, the newer
// version wins and the other is kept in the bin for 30 days.
// Progress is saved after every file, so a run that's cut off carries on next time.

import * as dbx from './dropbox.js';
import * as store from './store.js';
import * as journal from './journal.js';
import { journalKey, setRecovery, recoverySent } from './lock.js';
import { paths, JOURNAL_FORMAT, VERSION } from './format.js';
import { ENC_SUFFIX, decryptFile, encryptionInfo, openRecoveryBlock, keyId } from './crypto.js';
import { makeThumb, forgetUrls } from './ui.js';

const STATE = 'sync';
const remote = p => '/' + p + ENC_SUFFIX;
const lower = p => p.toLowerCase();
const text = new TextDecoder();

let state = null;
let running = null;
let again = false;
let progress = null;          // { phase, done, total }
let lastError = null;
let changedLocally = false;   // did this run bring anything new onto the phone?
const listeners = new Set();
let afterPull = () => {};

async function loadState() {
  state = { cursor: null, revs: {}, dirty: {}, gone: [], lastSync: null, needsKey: null, ...((await store.getMeta(STATE)) || {}) };
}
const saveState = () => store.setMeta(STATE, state);
const emit = () => listeners.forEach(fn => { try { fn(status()); } catch { /* ignore */ } });

export function status() {
  return { connected: dbx.connected(), running: !!running, progress, lastSync: state?.lastSync || null, error: lastError,
    needsKey: !!state?.needsKey, waiting: state ? Object.keys(state.dirty).length + state.gone.length : 0 };
}
export const onStatus = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/** Set up before the journal loads, so every change is noticed. */
export async function init({ onPulled } = {}) {
  await loadState();
  afterPull = onPulled || afterPull;
  let timer = null;
  journal.setSyncHooks({
    changed(id) {
      state.dirty[id] = (state.dirty[id] || 0) + 1;
      saveState();
      clearTimeout(timer); timer = setTimeout(() => syncNow(), 4000);
    },
    destroyed(id) {
      delete state.dirty[id];
      if (!state.gone.includes(id)) state.gone.push(id);
      saveState();
      clearTimeout(timer); timer = setTimeout(() => syncNow(), 4000);
    }
  });
  await dbx.loadAuth().catch(() => false);
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - (Date.parse(state.lastSync) || 0) > 60000) syncNow(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 10 * 60000);
}

/** Starts a sync (or queues one after the current run). Resolves when done. */
export function syncNow() {
  if (!dbx.connected() || !journalKey()) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    lastError = null; changedLocally = false; emit();
    try {
      do { again = false; await runOnce(); } while (again);
      state.lastSync = new Date().toISOString();
    } catch (e) {
      lastError = e.message || String(e);
      if (e.kind === 'signin') await dbx.disconnect().catch(() => {});
    } finally {
      progress = null;
      await saveState();
      running = null;
      emit();
      if (changedLocally) afterPull();
    }
  })();
  return running;
}

/** Signs out of Dropbox on this phone. The files in Dropbox stay. */
export async function disconnect() {
  await dbx.disconnect();
  state.cursor = null; state.revs = {}; state.needsKey = null; lastError = null;
  await saveState(); emit();
}

/** After connecting: every entry on the phone needs checking against Dropbox. */
export async function connected() {
  state.cursor = null; state.revs = {}; state.needsKey = null;
  await saveState();
  return syncNow();
}

const step = (phase, done, total) => { progress = { phase, done, total }; emit(); };

async function journalJson(k) {
  return {
    format: JOURNAL_FORMAT, version: VERSION, name: 'MMB Journal', created: state.created || new Date().toISOString(),
    note: 'Entries and photos in this folder are encrypted. Open them with the MMB Journal app, or with its decrypt page and your recovery key.',
    encryption: await encryptionInfo(k.raw, k.recovery)
  };
}
async function putJournalJson(k) {
  const bytes = new TextEncoder().encode(JSON.stringify(await journalJson(k), null, 2) + '\n');
  await dbx.upload('/journal.json', bytes);
}

async function runOnce() {
  const k = journalKey();

  // 1. journal.json: is this the same journal (the same key)?
  step('check', 0, 0);
  const rj = await dbx.downloadJson('/journal.json');
  if (rj && (rj.unreadable || rj.format !== JOURNAL_FORMAT || !rj.encryption?.keyId)) {
    throw new Error('Dropbox/Apps/MMB Journal has a journal.json the app doesn\'t recognise, so nothing was changed. Move it out of that folder, then sync again.');
  }
  if (rj && rj.encryption.keyId !== k.keyId) {
    state.needsKey = { keyId: rj.encryption.keyId, recovery: rj.encryption.recovery };
    throw new Error('Your Dropbox already has a journal, locked with a different recovery key.');
  }
  state.needsKey = null;
  // The recovery key: a phone sends its own only when it made a new one;
  // otherwise it takes the one in Dropbox (made on another phone).
  const here = k.recovery?.salt, there = rj?.encryption.recovery?.salt;
  if (!rj || (here !== there && k.recoveryPending)) await putJournalJson(k);
  else if (here !== there) await setRecovery(rj.encryption.recovery);
  if (k.recoveryPending) await recoverySent();

  // 2. What changed in Dropbox?
  step('download', 0, 0);
  let res = await dbx.list(state.cursor);
  if (res.reset) { state.cursor = null; state.revs = {}; res = await dbx.list(null); }
  const changed = [], deletedIds = new Set();
  for (const m of res.entries) {
    const rel = (m.path_display || m.path_lower).replace(/^\//, '');
    if (m['.tag'] === 'deleted') {
      const d = rel.match(/^entries\/([^/]+)(\/entry\.json\.enc)?$/i);
      if (d) deletedIds.add(d[1]);
      for (const p of Object.keys(state.revs)) if (p === lower('/' + rel) || p.startsWith(lower('/' + rel + '/'))) delete state.revs[p];
      continue;
    }
    if (m['.tag'] !== 'file') continue;
    const e = rel.match(/^entries\/([^/]+)\/entry\.json\.enc$/i);
    if (e) { if (state.revs[m.path_lower] !== m.rev) changed.push({ id: e[1], path: m.path_display, lower: m.path_lower, rev: m.rev }); }
    else if (/^entries\/[^/]+\/media\/[^/]+\.enc$/i.test(rel)) state.revs[m.path_lower] = m.rev;
  }

  let n = 0;
  for (const c of changed) {
    step('download', n++, changed.length);
    const bytes = await dbx.download(c.path);
    if (!bytes) continue;
    let incoming;
    try { incoming = JSON.parse(text.decode(await decryptFile(k.key, bytes, paths.entry(c.id)))); }
    catch { lastError = `An entry in Dropbox (${c.id}) couldn't be opened, so it was skipped.`; continue; }
    if (incoming.id !== c.id) continue;
    const local = journal.get(c.id);
    if (!local) { await journal.putFromSync(incoming, bytes); changedLocally = true; }
    else if (local.updated !== incoming.updated) {
      if (!state.dirty[c.id]) { await journal.putFromSync(incoming, bytes); changedLocally = true; }
      else if (incoming.updated > local.updated) {           // changed in both places: newer wins
        await journal.keepConflictCopy(local);
        await journal.putFromSync(incoming, bytes);
        delete state.dirty[c.id]; changedLocally = true;
      } else await journal.keepConflictCopy(incoming);
    }
    state.revs[c.lower] = c.rev;
    await saveState();
  }
  for (const id of deletedIds) {
    if (!state.dirty[id] && journal.get(id) && !changed.some(c => c.id === id)) { await journal.destroy(id, { fromSync: true }); changedLocally = true; }
  }
  state.cursor = res.cursor;
  await saveState();

  // Anything on the phone that Dropbox doesn't have yet (first sync, or missed before).
  for (const e of journal.all()) if (!state.revs[lower(remote(paths.entry(e.id)))] && !state.dirty[e.id]) state.dirty[e.id] = 1;

  // Photos and videos this phone doesn't have yet.
  const missing = [];
  for (const e of journal.all()) for (const m of e.media) {
    const p = paths.media(e.id, m.file);
    if (state.revs[lower(remote(p))] && !(await store.hasMedia(p))) missing.push(p);
  }
  n = 0;
  for (const p of missing) {
    step('photos', n++, missing.length);
    const bytes = await dbx.download(remote(p));
    if (!bytes) continue;
    try {
      const plain = await store.putMediaFile(p, bytes);
      await store.putThumb(p, await makeThumb(plain));
      forgetUrls(p);
      changedLocally = true;
    } catch { lastError = `A photo in Dropbox (${p}) couldn't be opened, so it was skipped.`; }
  }

  // 3. Send what changed here.
  const toSend = Object.keys(state.dirty);
  const total = state.gone.length + toSend.length;
  n = 0;
  for (const id of [...state.gone]) {
    step('upload', n++, total);
    await dbx.remove(`/entries/${id}`);
    for (const p of Object.keys(state.revs)) if (p.startsWith(lower(`/entries/${id}/`))) delete state.revs[p];
    state.gone = state.gone.filter(x => x !== id);
    await saveState();
  }
  for (const id of toSend) {
    step('upload', n++, total);
    const version = state.dirty[id];
    const e = journal.get(id);
    if (!e) { delete state.dirty[id]; continue; }
    for (const m of e.media) {
      const p = paths.media(id, m.file);
      if (state.revs[lower(remote(p))]) continue;
      const bytes = await store.mediaFile(p);
      if (!bytes) continue;                 // not on this phone (yet)
      const meta = await dbx.upload(remote(p), bytes);
      state.revs[meta.path_lower] = meta.rev;
      await saveState();
    }
    // Photos taken out of the entry.
    const keep = new Set(e.media.map(m => lower(remote(paths.media(id, m.file)))));
    for (const p of Object.keys(state.revs)) {
      if (p.startsWith(lower(`/entries/${id}/media/`)) && !keep.has(p)) { await dbx.remove(p); delete state.revs[p]; }
    }
    const bytes = await store.entryFile(id);
    const meta = await dbx.upload(remote(paths.entry(id)), bytes);
    state.revs[meta.path_lower] = meta.rev;
    if (state.dirty[id] === version) delete state.dirty[id];   // unless it was changed again meanwhile
    await saveState();
  }
}

/**
 * Dropbox already has a journal with a different key (for example, one made on
 * another phone). Its recovery key lets this phone take on that key.
 * checkDropboxKey throws a readable message if the recovery key is wrong.
 */
export async function checkDropboxKey(recoveryText) {
  const nk = state.needsKey;
  if (!nk) throw new Error('Dropbox doesn\'t need a recovery key right now. Try syncing again.');
  const raw = await openRecoveryBlock(nk.recovery, recoveryText);
  if (await keyId(raw) !== nk.keyId) throw new Error('That recovery key doesn\'t match the journal in Dropbox.');
  return { raw, recovery: nk.recovery, keyId: nk.keyId };
}
export async function joinDropboxJournal(checked, adopt) {
  if (!(await adopt(checked.raw, checked.recovery, checked.keyId))) return false;
  state.needsKey = null; state.cursor = null; state.revs = {};
  for (const e of journal.all()) state.dirty[e.id] = (state.dirty[e.id] || 0) + 1;
  await saveState();
  lastError = null; emit();
  syncNow();
  return true;
}
