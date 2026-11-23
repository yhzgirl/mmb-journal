// The journal's copy on the phone (IndexedDB). Media are stored under the same
// paths they have in the journal folder (entries/<id>/media/<file>), so syncing to
// Dropbox later is a straight copy.

const DB_NAME = 'mmb-journal';
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('entries', { keyPath: 'id' });
      d.createObjectStore('media');    // path → Blob (full photo or video)
      d.createObjectStore('thumbs');   // path → Blob (small JPEG for lists)
      d.createObjectStore('meta');     // key → any (settings, journal.json)
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

export const allEntries = () => run('entries', 'readonly', s => req(s.getAll()));
export const getEntry = id => run('entries', 'readonly', s => req(s.get(id)));
export const putEntry = entry => run('entries', 'readwrite', s => { s.put(entry); });
export const putEntries = entries => run('entries', 'readwrite', s => { for (const e of entries) s.put(e); });

export const getMedia = path => run('media', 'readonly', s => req(s.get(path)));
export const getThumb = path => run('thumbs', 'readonly', s => req(s.get(path)));
export const putMedia = (path, blob, thumb) => run(['media', 'thumbs'], 'readwrite', (m, t) => {
  m.put(blob, path);
  if (thumb) t.put(thumb, path); else t.delete(path);
});
export const deleteMedia = paths => run(['media', 'thumbs'], 'readwrite', (m, t) => {
  for (const p of paths) { m.delete(p); t.delete(p); }
});

/** Removes an entry and all its photos for good. */
export async function destroyEntry(entry) {
  await run(['entries', 'media', 'thumbs'], 'readwrite', (e, m, t) => {
    e.delete(entry.id);
    const range = IDBKeyRange.bound(`entries/${entry.id}/`, `entries/${entry.id}/￿`);
    m.delete(range); t.delete(range);
  });
}

export const getMeta = key => run('meta', 'readonly', s => req(s.get(key)));
export const setMeta = (key, value) => run('meta', 'readwrite', s => { s.put(value, key); });

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
