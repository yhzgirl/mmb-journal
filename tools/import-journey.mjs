#!/usr/bin/env node
// Converts a Journey backup ZIP into an MMB Journal backup ZIP, then checks the
// result against the original. Prints counts only, never entry text.
//
//   node tools/import-journey.mjs <journey-backup.zip> <mmb-journal-backup.zip>

import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from '../src/vendor/fflate.js';
import { convertJourneyZip, describeReport, moodFromSentiment } from '../src/import/journey.js';
import { writeJournalZip, readJournalZip } from '../src/backup-zip.js';
import { paths, localDay } from '../src/format.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('Usage: node tools/import-journey.mjs <journey.zip> <out.zip>'); process.exit(2); }

const zip = readFileSync(input);
const { entries, files, report } = convertJourneyZip(zip);
console.log('Import summary');
for (const line of describeReport(report)) console.log('  ' + line);
if (report.warnings.length) { console.log('Warnings'); for (const w of report.warnings) console.log('  ' + w); }

const out = writeJournalZip(entries, files);
writeFileSync(output, out);
console.log(`\nWrote ${(out.length / 1e6).toFixed(1)} MB`);

// ---- Check the written backup against the original Journey ZIP ----
const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const back = readJournalZip(out);
check('Backup reads back and every entry is valid', back.problems.length === 0, back.problems.slice(0, 5).join('; '));

const original = unzipSync(new Uint8Array(zip));
const journey = new Map();
for (const [p, bytes] of Object.entries(original)) {
  const m = p.match(/(?:^|\/)([^/]+)\/\1\.json$/);
  if (m) journey.set(m[1], JSON.parse(strFromU8(bytes)));
}
const byId = new Map(back.entries.map(e => [e.id, e]));
check('Every Journey entry is in the backup', journey.size === back.entries.length && [...journey.keys()].every(id => byId.has(id)),
  `${journey.size} in Journey, ${back.entries.length} in backup`);

let htmlSame = 0, htmlTotal = 0, mdOk = 0, mdTotal = 0, moodOk = 0, dateOk = 0, tagsOk = 0, favOk = 0, locOk = 0;
for (const [id, j] of journey) {
  const e = byId.get(id); if (!e) continue;
  if (j.type === 'markdown') { mdTotal++; if (/<(p|h\d|ul|ol|li|strong|em|blockquote)\b/.test(e.text) || !j.text.trim()) mdOk++; }
  else { htmlTotal++; if (e.text === j.text) htmlSame++; }
  if (e.mood === moodFromSentiment(j.sentiment)) moodOk++;
  if (Date.parse(e.date) === Date.parse(j.dateOfJournal)) dateOk++;
  if (JSON.stringify(e.tags) === JSON.stringify([...new Set(j.tags.map(t => t.trim()).filter(Boolean))])) tagsOk++;
  if (e.favourite === !!j.favourite) favOk++;
  if ((!!e.location) === (Number.isFinite(j.location?.lat))) locOk++;
}
const n = journey.size;
check('HTML text copied exactly', htmlSame === htmlTotal, `${htmlSame} of ${htmlTotal}`);
check('Markdown entries converted to HTML', mdOk === mdTotal, `${mdOk} of ${mdTotal}`);
check('Dates unchanged', dateOk === n, `${dateOk} of ${n}`);
check('Moods mapped', moodOk === n, `${moodOk} of ${n}`);
check('Tags unchanged', tagsOk === n, `${tagsOk} of ${n}`);
check('Favourites unchanged', favOk === n, `${favOk} of ${n}`);
check('Places kept', locOk === n, `${locOk} of ${n}`);

// Every photo and video byte-for-byte identical, in the original ZIP order.
let mediaSame = 0, mediaTotal = 0, orderOk = 0, orderTotal = 0;
for (const e of back.entries) {
  const originals = Object.keys(original).filter(p => p.split('/').slice(-2, -1)[0] === e.id && !p.endsWith('.json') && !p.endsWith('/'));
  orderTotal++;
  if (JSON.stringify(originals.map(p => p.split('/').pop().replace(/\.[^.]+$/, ''))) === JSON.stringify(e.media.map(m => m.id))) orderOk++;
  for (const p of originals) {
    mediaTotal++;
    const name = p.split('/').pop().replace(/\.[^.]+$/, '');
    const m = e.media.find(x => x.id === name);
    const copy = m && back.files.get(paths.media(e.id, m.file));
    if (copy && copy.length === original[p].length && Buffer.compare(Buffer.from(copy), Buffer.from(original[p])) === 0) mediaSame++;
  }
}
check('Photos and videos identical', mediaSame === mediaTotal, `${mediaSame} of ${mediaTotal}`);
check('Photo order follows the ZIP', orderOk === orderTotal, `${orderOk} of ${orderTotal}`);

const sized = back.entries.flatMap(e => e.media).filter(m => m.type.startsWith('image/'));
check('Photo sizes read', sized.every(m => m.width > 0 && m.height > 0), `${sized.filter(m => m.width).length} of ${sized.length}`);

check('index.json lists every entry', back.index?.entries.length === n, `${back.index?.entries.length} of ${n}`);
const days = new Set(back.entries.map(e => localDay(e).slice(5)));
check('Calendar days with an entry (for On This Day)', days.size > 0, `${days.size} different days of the year`);

console.log('\nChecks');
for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
const failed = checks.filter(c => !c.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
