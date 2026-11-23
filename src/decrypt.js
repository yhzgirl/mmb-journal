// The stand-alone decrypt page (decrypt.html). Needs only the Dropbox folder (as a
// ZIP) and the recovery key; it doesn't use anything stored by the app.
import { unzipSync, strFromU8 } from './vendor/fflate.js';
import { openRecoveryBlock, importJournalKey, decryptFile, keyId, parseRecoveryKey, ENC_SUFFIX } from './crypto.js';
import { writeJournalZip } from './backup-zip.js';
import { validateEntry } from './format.js';

const $ = s => document.querySelector(s);
const out = $('#out');
const say = (msg, cls) => { const p = document.createElement('p'); p.textContent = msg; if (cls) p.className = cls; out.append(p); };
const ready = () => { $('#go').disabled = !($('#zip').files.length && parseRecoveryKey($('#key').value)); };
$('#zip').onchange = ready; $('#key').oninput = ready;

$('#go').onclick = async () => {
  $('#go').disabled = true; out.replaceChildren();
  try {
    say('Reading the ZIP…');
    await new Promise(r => setTimeout(r, 30));
    const all = unzipSync(new Uint8Array(await $('#zip').files[0].arrayBuffer()));
    const jPath = Object.keys(all).filter(p => /(^|\/)journal\.json$/.test(p)).sort((a, b) => a.length - b.length)[0];
    if (!jPath) throw new Error('There\'s no journal.json in this ZIP. Download the whole MMB Journal folder from Dropbox/Apps.');
    const root = jPath.slice(0, -'journal.json'.length);
    const journal = JSON.parse(strFromU8(all[jPath]));
    if (!journal.encryption?.recovery) throw new Error('This journal.json has no encryption details, so it may already be plain files.');
    const raw = await openRecoveryBlock(journal.encryption.recovery, $('#key').value);
    if (await keyId(raw) !== journal.encryption.keyId) throw new Error('That recovery key doesn\'t match this journal.');
    const key = await importJournalKey(raw);
    say('Recovery key accepted. Opening files…');

    const entries = [], files = new Map(), problems = [];
    for (const [p, bytes] of Object.entries(all)) {
      if (!p.startsWith(root) || !p.endsWith(ENC_SUFFIX)) continue;
      const rel = p.slice(root.length, -ENC_SUFFIX.length);
      let plain;
      try { plain = await decryptFile(key, bytes, rel); } catch { problems.push(`${rel} couldn't be opened`); continue; }
      if (/^entries\/[^/]+\/entry\.json$/.test(rel)) {
        const e = JSON.parse(strFromU8(plain));
        const bad = validateEntry(e).filter(x => x !== 'media');
        if (bad.length) problems.push(`${e.id}: ${bad.join(', ')}`);
        entries.push(e);
      } else if (/^entries\/[^/]+\/media\//.test(rel)) files.set(rel, plain);
    }
    for (const e of entries) e.media = e.media.filter(m => files.has(`entries/${e.id}/${m.file}`) || (problems.push(`${e.id}: missing ${m.file}`), false));
    entries.sort((a, b) => b.date.localeCompare(a.date));
    const zip = writeJournalZip(entries, files, { name: journal.name, created: journal.created });
    const name = `MMB Journal backup (plain) ${new Date().toISOString().slice(0, 10)}.zip`;
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name, className: 'btn', textContent: 'Save the plain backup again' });
    say(`Opened ${entries.length} entries and ${files.size} photos and videos.`);
    problems.forEach(p => say(p, 'error'));
    out.append(a);
    a.click();
  } catch (e) {
    say(e.message, 'error');
  } finally { ready(); }
};
