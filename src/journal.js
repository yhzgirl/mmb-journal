// The journal in memory: every entry is loaded at start (a few thousand entries is
// still only a few MB), so the timeline, calendar, On This Day and search are instant.

import * as store from './store.js';
import { localDay, previewText, paths, newId } from './format.js';
import { makeThumb, forgetUrls } from './ui.js';

const BIN_DAYS = 30;
let entries = [];

// Sync listens for changes (set up by sync.js before the journal loads).
let hooks = { changed() {}, destroyed() {} };
export const setSyncHooks = h => { hooks = h; };
const plain = new Map();   // id → plain text, for search

export async function load() {
  entries = await store.allEntries();
  // Empty the bin of anything deleted more than 30 days ago.
  const cutoff = Date.now() - BIN_DAYS * 864e5;
  for (const e of entries.filter(e => e.deleted && Date.parse(e.deleted) < cutoff)) await destroy(e.id);
  plain.clear();
  return entries.length;
}

const byNewest = (a, b) => b.date.localeCompare(a.date);
export const live = () => entries.filter(e => !e.deleted).sort(byNewest);
export const binned = () => entries.filter(e => e.deleted).sort((a, b) => b.deleted.localeCompare(a.deleted));
export const get = id => entries.find(e => e.id === id);
export const binDaysLeft = e => Math.max(0, Math.ceil((Date.parse(e.deleted) + BIN_DAYS * 864e5 - Date.now()) / 864e5));

export function plainText(e) {
  if (!plain.has(e.id)) plain.set(e.id, previewText(e.text, Infinity));
  return plain.get(e.id);
}

/** Saves an entry. newMedia: [{ file, blob }] photos added in the editor; removed: media files taken out. */
export async function save(entry, { newMedia = [], removed = [] } = {}) {
  for (const { file, blob } of newMedia) {
    await store.putMedia(paths.media(entry.id, file), blob, await makeThumb(blob));
  }
  if (removed.length) {
    const p = removed.map(f => paths.media(entry.id, f));
    p.forEach(forgetUrls);
    await store.deleteMedia(p);
  }
  await store.putEntry(entry);
  const i = entries.findIndex(e => e.id === entry.id);
  if (i >= 0) entries[i] = entry; else entries.push(entry);
  plain.delete(entry.id);
  hooks.changed(entry.id);
  store.keepStorage();
}

export async function moveToBin(id) {
  const e = get(id); if (!e) return;
  const now = new Date().toISOString();
  await save({ ...e, deleted: now, updated: now });
}
export async function restore(id) {
  const e = get(id); if (!e) return;
  await save({ ...e, deleted: null, updated: new Date().toISOString() });
}
export async function destroy(id, { fromSync = false } = {}) {
  const e = get(id) || entries.find(x => x.id === id);
  if (!e) return;
  e.media.forEach(m => forgetUrls(paths.media(e.id, m.file)));
  await store.destroyEntry(e);
  entries = entries.filter(x => x.id !== id);
  plain.delete(id);
  if (!fromSync) hooks.destroyed(id);
}

/** Adds imported entries (replacing any with the same ID) with their photos. */
export async function addImported(list, files, onProgress = () => {}) {
  let done = 0;
  const total = list.length;
  for (const e of list) {
    const old = get(e.id);
    if (old) await store.deleteMedia(old.media.map(m => paths.media(old.id, m.file)));
    for (const m of e.media) {
      const p = paths.media(e.id, m.file);
      const blob = new Blob([files.get(p)], { type: m.type });
      forgetUrls(p);
      await store.putMedia(p, blob, await makeThumb(blob));
    }
    await store.putEntry(e);
    const i = entries.findIndex(x => x.id === e.id);
    if (i >= 0) entries[i] = e; else entries.push(e);
    plain.delete(e.id);
    hooks.changed(e.id);
    onProgress(++done, total);
  }
  await store.keepStorage();
}

/** Entries from the same calendar date in earlier years. 29 Feb shows on 28 Feb in other years. */
export function onThisDay(today = new Date()) {
  const y = today.getFullYear();
  const md = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const wanted = new Set([md]);
  if (md === '02-28' && !leap) wanted.add('02-29');
  return live().filter(e => {
    const d = localDay(e);
    return Number(d.slice(0, 4)) < y && wanted.has(d.slice(5));
  }).map(e => ({ entry: e, years: y - Number(localDay(e).slice(0, 4)) }));
}

/** Map of "YYYY-MM-DD" → entries on that day. */
export function byDay() {
  const map = new Map();
  for (const e of live()) {
    const d = localDay(e);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(e);
  }
  return map;
}

export function tagCounts() {
  const counts = new Map();
  for (const e of live()) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));
}

export const count = () => live().length;
export const all = () => entries.slice();

/** An entry that arrived from Dropbox (already encrypted as `bytes`). Removes photos it no longer has. */
export async function putFromSync(entry, bytes) {
  const old = get(entry.id);
  if (old) {
    const gone = old.media.filter(m => !entry.media.some(n => n.file === m.file)).map(m => paths.media(old.id, m.file));
    gone.forEach(forgetUrls);
    if (gone.length) await store.deleteMedia(gone);
  }
  await store.putEntryFile(entry.id, bytes);
  const i = entries.findIndex(e => e.id === entry.id);
  if (i >= 0) entries[i] = entry; else entries.push(entry);
  plain.delete(entry.id);
}

/** When the same entry was changed in two places, the other version is kept in the bin. */
export async function keepConflictCopy(entry) {
  const now = new Date().toISOString();
  await save({ ...entry, id: newId(), media: [], deleted: now, updated: now,
    source: { app: 'MMB Journal', conflictOf: entry.id, note: 'Another version of this entry, kept when it was changed in two places at once. Photos stay with the main entry.' } });
}
export const allForBackup = () => entries.slice().sort(byNewest);
