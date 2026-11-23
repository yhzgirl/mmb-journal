// Import: a Journey backup ZIP or an MMB Journal backup ZIP. Shows what was found
// and writes nothing until "Import" is tapped. The ZIP never leaves the phone.
import * as journal from '../journal.js';
import { h, pageHead, toast } from '../ui.js';
import { unzipSync } from '../vendor/fflate.js';
import { convertJourneyZip, describeReport } from '../import/journey.js';
import { readJournalZip } from '../backup-zip.js';
import { backButton } from './parts.js';
import { setLeaveGuard } from '../main.js';

const nextFrame = () => new Promise(r => setTimeout(r, 60));

export default function importView(main) {
  main.append(pageHead('Import', backButton('#/more')));
  const input = h('input', { type: 'file', accept: '.zip,application/zip', id: 'zip', class: 'visually-hidden' });
  const status = h('div', { 'aria-live': 'polite' });
  main.append(
    h('p', {}, 'Choose a Journey backup ZIP, or a backup made by this app. Nothing is added until you check what was found and tap Import.'),
    h('p', { class: 'muted small' }, 'The file is read on this phone and isn\'t uploaded anywhere.'),
    h('label', { class: 'btn', for: 'zip' }, 'Choose a ZIP file'), input, status);

  let busy = false;
  setLeaveGuard(() => !busy || confirm('An import is still running. Leave anyway?'));

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    status.replaceChildren(h('p', { class: 'muted' }, `Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB)…`));
    await nextFrame();
    let result, kind;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isBackup = Object.keys(unzipSync(bytes, { filter: f => f.name === 'journal.json' })).length > 0;
      if (isBackup) {
        kind = 'backup';
        const b = readJournalZip(bytes);
        if (b.problems.length) throw new Error(`The backup has problems: ${b.problems.slice(0, 3).join('; ')}`);
        result = { entries: b.entries, files: b.files, lines: backupLines(b) };
      } else {
        kind = 'journey';
        const r = convertJourneyZip(bytes);
        if (!r.entries.length) throw new Error('No Journey entries were found in this ZIP.');
        result = { entries: r.entries, files: r.files, lines: describeReport(r.report), warnings: r.report.warnings };
      }
    } catch (err) {
      status.replaceChildren(h('p', { class: 'card report', role: 'alert' }, 'This file couldn\'t be read: ' + err.message));
      return;
    }

    const existing = result.entries.filter(e => journal.get(e.id)).length;
    const go = h('button', { class: 'btn' }, `Import ${result.entries.length} entries`);
    status.replaceChildren(h('section', { class: 'card report' },
      h('h2', {}, kind === 'journey' ? 'Found in your Journey backup' : 'Found in this backup'),
      h('ul', {}, result.lines.map(l => h('li', {}, l))),
      existing ? h('p', {}, `${existing} of these are already in your journal and will be replaced by the copy in this file.`) : null,
      result.warnings?.length ? h('details', {}, h('summary', {}, `${result.warnings.length} notes`), h('ul', {}, result.warnings.map(w => h('li', { class: 'small' }, w)))) : null,
      h('div', { class: 'row', style: 'margin-top:12px' }, go)));

    go.onclick = async () => {
      busy = true; go.disabled = true; input.disabled = true;
      const bar = h('div'); const label = h('p', { class: 'muted small' }, 'Saving to this phone…');
      go.closest('.report').append(h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Import progress' }, bar), label);
      try {
        await journal.addImported(result.entries, result.files, (done, total) => {
          bar.style.width = `${Math.round(done / total * 100)}%`;
          label.textContent = `Saved ${done} of ${total} entries…`;
        });
        busy = false;
        label.textContent = 'Done.';
        go.closest('.report').append(h('a', { class: 'btn', href: '#/' }, 'Open the journal'));
        toast(`${result.entries.length} entries imported`);
      } catch (err) {
        busy = false;
        label.textContent = 'The import stopped: ' + err.message + '. Entries saved so far are kept; you can run it again safely.';
      }
    };
  };
}

function backupLines(b) {
  const live = b.entries.filter(e => !e.deleted);
  const dates = live.map(e => e.date).sort();
  const media = b.entries.flatMap(e => e.media);
  return [
    `${live.length} entries${dates.length ? ` from ${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}` : ''}`,
    `${media.filter(m => m.type.startsWith('image/')).length} photos and ${media.filter(m => m.type.startsWith('video/')).length} videos`,
    b.entries.length > live.length ? `${b.entries.length - live.length} in the bin` : null
  ].filter(Boolean);
}
