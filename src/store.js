// The journal's copy on the phone (IndexedDB). Entries, photos, videos and
// thumbnails are stored encrypted with the journal key, in exactly the form they
// take in Dropbox (see crypto.js), so syncing is a straight copy of the bytes.
// Media are stored under their journal paths (entries/<id>/media/<file>).
//
// Nothing can be read until setKeys() is given the journal key after unlocking.
// Settings and the lock details are not secret and stay readable.

import { encryptFile, decryptFile, isEncrypted } from './crypto.js';
import { paths, MEDIA_TYPES } from './format.js';

const DB_NAME = 'mmb-journal';
const SEALED = 'application/x-mmb-encrypted';   // Blob type marking encrypted media
let dbPromise;
let key = null, oldKey = null;                  // oldKey: only while moving to a new journal key

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('entries', { keyPath: 'id' });   // { id, data: encrypted entry.json }
      d.createObjectStore('media');    // path → Blob (encrypted photo or video)
      d.createObjectStore('thumbs');   // path → Blob (encrypted small JPEG for lists)
      d.createObjectStore('meta');     // key → any (settings, lock, sync state)
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    Promise.resolve(fn(...[].concat(stores).map(s => t.objectStore(s)))).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage was interrupted'));
  });
}
const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export function setKeys(current, previous = null) { key = current; oldKey = previous; }
export const unlocked = () => !!key;

function needKey() { if (!key) throw new Error('The journal is locked'); }
const seal = (bytes, aad) => { needKey(); return encryptFile(key, bytes, aad); };
async function open(bytes, aad) {
  needKey();
  try { return await decryptFile(key, bytes, aad); }
  catch (e) { if (oldKey) return decryptFile(oldKey, bytes, aad); throw e; }
}
const toBytes = async v => v instanceof Uint8Array ? v : v instanceof Blob ? new Uint8Array(await v.arrayBuffer()) : new Uint8Array(v);
const typeOf = path => MEDIA_TYPES[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
const thumbAad = path => 'thumb:' + path;
const text = new TextDecoder();

// ---------- entries ----------

/** How many entries are stored (works while locked). */
export const countEntries = () => run('entries', 'readonly', s => req(s.count()));

/** All entries, decrypted. Entries that can't be opened are counted in loadProblems. */
export let loadProblems = 0;
export async function allEntries() {
  const records = await run('entries', 'readonly', s => req(s.getAll()));
  const out = [];
  loadProblems = 0;
  for (const r of records) {
    if (!r.data) { out.push(r); continue; }        // from before encryption (sealed at unlock)
    try { out.push(JSON.parse(text.decode(await open(await toBytes(r.data), paths.entry(r.id))))); }
    catch { loadProblems++; }
  }
  return out;
}
export async function putEntry(entry) {
  const data = await seal(JSON.stringify(entry), paths.entry(entry.id));
  await run('entries', 'readwrite', s => { s.put({ id: entry.id, data }); });
}
/** The encrypted entry.json, ready to upload. */
export async function entryFile(id) {
  const r = await run('entries', 'readonly', s => req(s.get(id)));
  if (!r) return null;
  if (!r.data) { await putEntry(r); return entryFile(id); }
  return toBytes(r.data);
}
/** Stores an entry.json downloaded from Dropbox (already opened and checked by the caller). */
export const putEntryFile = (id, data) => run('entries', 'readwrite', s => { s.put({ id, data }); });

// ---------- photos and videos ----------

export async function getMedia(path) {
  const b = await run('media', 'readonly', s => req(s.get(path)));
  if (!b || b.type !== SEALED) return b;
  return new Blob([await open(await toBytes(b), path)], { type: typeOf(path) });
}
export async function getThumb(path) {
  const b = await run('thumbs', 'readonly', s => req(s.get(path)));
  if (!b || b.type !== SEALED) return b;
  return new Blob([await open(await toBytes(b), thumbAad(path))], { type: 'image/jpeg' });
}
export async function putMedia(path, blob, thumb) {
  const m = new Blob([await seal(await toBytes(blob), path)], { type: SEALED });
  const t = thumb ? new Blob([await seal(await toBytes(thumb), thumbAad(path))], { type: SEALED }) : null;
  await run(['media', 'thumbs'], 'readwrite', (ms, ts) => { ms.put(m, path); if (t) ts.put(t, path); else ts.delete(path); });
}
/** The encrypted photo or video, ready to upload. */
export async function mediaFile(path) {
  const b = await run('media', 'readonly', s => req(s.get(path)));
  if (!b) return null;
  if (b.type !== SEALED) { await putMedia(path, b, await getThumb(path)); return mediaFile(path); }
  return toBytes(b);
}
/** Stores a photo or video downloaded from Dropbox, after checking it opens. Returns it as a plain Blob. */
export async function putMediaFile(path, data) {
  const plain = new Blob([await open(data, path)], { type: typeOf(path) });
  await run('media', 'readwrite', s => { s.put(new Blob([data], { type: SEALED }), path); });
  return plain;
}
export async function putThumb(path, thumb) {
  if (!thumb) return;
  const t = new Blob([await seal(await toBytes(thumb), thumbAad(path))], { type: SEALED });
  await run('thumbs', 'readwrite', s => { s.put(t, path); });
}
export const hasMedia = async path => (await run('media', 'readonly', s => req(s.count(path)))) > 0;
export const deleteMedia = list => run(['media', 'thumbs'], 'readwrite', (m, t) => {
  for (const p of list) { m.delete(p); t.delete(p); }
});

/** Removes an entry and all its photos for good. */
export async function destroyEntry(entry) {
  await run(['entries', 'media', 'thumbs'], 'readwrite', (e, m, t) => {
    e.delete(entry.id);
    const range = IDBKeyRange.bound(`entries/${entry.id}/`, `entries/${entry.id}/￿`);
    m.delete(range); t.delete(range);
  });
}

/**
 * Makes sure everything on the phone is encrypted with the current journal key:
 * encrypts anything stored before encryption, and re-encrypts anything still
 * under the old key. Safe to stop part-way and run again.
 */
export async function sealEverything(onProgress = () => {}) {
  needKey();
  const ids = await run('entries', 'readonly', s => req(s.getAllKeys()));
  const mediaKeys = await run('media', 'readonly', s => req(s.getAllKeys()));
  const thumbKeys = await run('thumbs', 'readonly', s => req(s.getAllKeys()));
  const total = ids.length + mediaKeys.length + thumbKeys.length;
  let done = 0, changed = 0;
  const current = async (bytes, aad) => { try { await decryptFile(key, bytes, aad); return true; } catch { return false; } };

  for (const id of ids) {
    const r = await run('entries', 'readonly', s => req(s.get(id)));
    if (r && !r.data) { await putEntry(r); changed++; }
    else if (r && oldKey && !(await current(await toBytes(r.data), paths.entry(id)))) {
      await putEntry(JSON.parse(text.decode(await open(await toBytes(r.data), paths.entry(id))))); changed++;
    }
    onProgress(++done, total);
  }
  for (const [storeName, keys, aadOf] of [['media', mediaKeys, p => p], ['thumbs', thumbKeys, thumbAad]]) {
    for (const p of keys) {
      const b = await run(storeName, 'readonly', s => req(s.get(p)));
      let plain = null;
      if (b && b.type !== SEALED) plain = await toBytes(b);
      else if (b && oldKey && !(await current(await toBytes(b), aadOf(p)))) plain = await open(await toBytes(b), aadOf(p));
      if (plain) {
        const sealed = new Blob([await seal(plain, aadOf(p))], { type: SEALED });
        await run(storeName, 'readwrite', s => { s.put(sealed, p); });
        changed++;
      }
      onProgress(++done, total);
    }
  }
  return changed;
}

/** Quick check: is anything still stored without encryption? */
export async function hasUnsealed() {
  const r = await run('entries', 'readonly', s => req(s.getAll()));
  if (r.some(x => !x.data)) return true;
  const m = await run('media', 'readonly', s => req(s.getAll()));
  return m.some(b => b.type !== SEALED);
}

// ---------- settings, lock and sync state ----------

export const getMeta = k => run('meta', 'readonly', s => req(s.get(k)));
export const setMeta = (k, value) => run('meta', 'readwrite', s => { s.put(value, k); });
export const deleteMeta = k => run('meta', 'readwrite', s => { s.delete(k); });

/** Small secrets (the Dropbox sign-in), kept encrypted with the journal key. */
export async function setSecret(name, value) {
  await setMeta('secret:' + name, await seal(JSON.stringify(value), 'local:' + name));
}
export async function getSecret(name) {
  const data = await getMeta('secret:' + name);
  if (!data || !isEncrypted(await toBytes(data))) return null;
  try { return JSON.parse(text.decode(await open(await toBytes(data), 'local:' + name))); } catch { return null; }
}
export const deleteSecret = name => deleteMeta('secret:' + name);

/** Asks the browser not to clear the journal when the phone is short of space. */
export async function keepStorage() {
  try { return navigator.storage?.persisted && (await navigator.storage.persisted() || await navigator.storage.persist()); }
  catch { return false; }
}

export async function storageUse() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; }
  catch { return null; }
}

/** Deletes the journal, photos and settings on this phone (used when the PIN is forgotten). */
export async function eraseEverything() {
  if (dbPromise) { (await dbPromise).close(); dbPromise = null; }
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = resolve; r.onblocked = resolve; r.onerror = () => reject(r.error);
  });
}
