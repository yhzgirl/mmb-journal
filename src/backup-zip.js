// MMB Journal backup ZIP: the same folder layout as the journal in Dropbox
// (journal.json, index.json, entries/<id>/entry.json + media/), so a backup can be
// opened by hand, restored by the app, or uploaded as it is.

import { zipSync, unzipSync, strToU8, strFromU8 } from './vendor/fflate.js';
import { paths, buildIndex, buildJournal, validateEntry, JOURNAL_FORMAT } from './format.js';

const json = v => strToU8(JSON.stringify(v, null, 2) + '\n');

/** entries: array of entries; files: Map of journal path → bytes (media). */
export function writeJournalZip(entries, files, existingJournal = {}) {
  const out = {};
  out[paths.journal] = [json(buildJournal(entries, existingJournal)), { level: 6 }];
  out[paths.index] = [json(buildIndex(entries)), { level: 6 }];
  for (const e of entries) {
    out[paths.entry(e.id)] = [json(e), { level: 6 }];
    for (const m of e.media) {
      const p = paths.media(e.id, m.file);
      const bytes = files.get(p);
      if (!bytes) throw new Error(`Missing media file ${p}`);
      out[p] = [bytes, { level: 0 }];   // photos and videos are already compressed
    }
  }
  return zipSync(out, { mtime: new Date() });
}

/** Reads a backup ZIP back into entries + media, checking every entry. */
export function readJournalZip(zipBytes) {
  const all = unzipSync(zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes));
  if (!all[paths.journal]) throw new Error('This is not an MMB Journal backup (no journal.json).');
  const journal = JSON.parse(strFromU8(all[paths.journal]));
  if (journal.format !== JOURNAL_FORMAT) throw new Error('journal.json is not an MMB Journal file.');
  const index = all[paths.index] ? JSON.parse(strFromU8(all[paths.index])) : null;
  const entries = [], files = new Map(), problems = [];
  for (const [p, bytes] of Object.entries(all)) {
    if (/^entries\/[^/]+\/entry\.json$/.test(p)) {
      const e = JSON.parse(strFromU8(bytes));
      const bad = validateEntry(e).filter(x => x !== 'media' || e.media.length <= 10);
      if (bad.length) problems.push(`${e.id}: ${bad.join(', ')}`);
      entries.push(e);
    } else if (/^entries\/[^/]+\/media\//.test(p)) files.set(p, bytes);
  }
  for (const e of entries) for (const m of e.media) {
    if (!files.has(paths.media(e.id, m.file))) problems.push(`${e.id}: missing ${m.file}`);
  }
  return { journal, index, entries, files, problems };
}
