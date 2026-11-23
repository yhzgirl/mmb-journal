// More: look and feel, import, backup, bin and storage.
import * as journal from '../journal.js';
import { h, icon, pageHead, toast } from '../ui.js';
import { THEMES, SIZES, LEADINGS, settings, applySettings } from '../settings.js';
import { getMedia, storageUse, keepStorage } from '../store.js';
import { writeJournalZip } from '../backup-zip.js';
import { paths } from '../format.js';

export default async function moreView(main) {
  main.append(pageHead('More'));
  const seg = (options, key, label) => {
    const box = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const draw = () => box.replaceChildren(...options.map(o => {
      const [id, name, extra] = Array.isArray(o) ? o : [o.id, o.name, o];
      return h('button', { 'aria-pressed': String(settings()[key] === id), title: extra?.note,
        onclick: async () => { await applySettings({ [key]: id }); draw(); } },
        extra?.dot ? h('span', { class: 'theme-dot', style: `background:${extra.dot}`, 'aria-hidden': 'true' }) : null, name);
    }));
    draw();
    return box;
  };

  main.append(
    h('h2', { class: 'section-title' }, 'Theme'), seg(THEMES, 'theme', 'Theme'),
    h('h2', { class: 'section-title' }, 'Text size'), seg(SIZES, 'size', 'Text size'),
    h('h2', { class: 'section-title' }, 'Line spacing'), seg(LEADINGS, 'leading', 'Line spacing'),
    h('p', { class: 'prose', style: 'margin-top:12px' }, 'This is how entries will look.'));

  const exportBtn = h('button', {}, h('span', { class: 'row' }, icon('download'), 'Save a backup ZIP'), h('span', { class: 'muted small' }, 'Everything, as plain files'));
  exportBtn.onclick = () => exportBackup(exportBtn);
  main.append(h('h2', { class: 'section-title' }, 'Your journal'),
    h('div', { class: 'card list' },
      h('a', { href: '#/import' }, h('span', { class: 'row' }, icon('upload'), 'Import'), h('span', { class: 'muted small' }, 'From Journey or a backup')),
      exportBtn,
      h('a', { href: '#/bin' }, h('span', { class: 'row' }, icon('bin'), 'Bin'), h('span', { class: 'muted small' }, `${journal.binned().length} entries`))));

  const use = await storageUse();
  const kept = await keepStorage();
  main.append(h('h2', { class: 'section-title' }, 'On this phone'),
    h('div', { class: 'card list' },
      h('div', { class: 'item' }, 'Entries', h('span', {}, String(journal.count()))),
      use ? h('div', { class: 'item' }, 'Space used', h('span', {}, `${(use.used / 1e6).toFixed(0)} MB`)) : null,
      h('div', { class: 'item' }, 'Protected from clean-up', h('span', {}, kept ? 'Yes' : 'Not yet'))),
    h('p', { class: 'muted small', style: 'margin:16px 4px' }, 'Dropbox sync, passcode and fingerprint lock are coming next. Until then, your journal is only on this phone, so save a backup ZIP now and then.'));
}

async function exportBackup(btn) {
  btn.disabled = true;
  const label = btn.querySelector('.row').lastChild;
  label.textContent = 'Preparing backup…';
  try {
    await new Promise(r => setTimeout(r, 50));
    const entries = journal.allForBackup();
    const files = new Map();
    for (const e of entries) for (const m of e.media) {
      const p = paths.media(e.id, m.file);
      const blob = await getMedia(p);
      if (blob) files.set(p, new Uint8Array(await blob.arrayBuffer()));
      else throw new Error(`a photo is missing (${m.file})`);
    }
    const zip = writeJournalZip(entries, files);
    const name = `MMB Journal backup ${new Date().toISOString().slice(0, 10)}.zip`;
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Backup saved: ${(zip.length / 1e6).toFixed(0)} MB`);
  } catch (err) {
    toast('Backup failed: ' + err.message);
  } finally {
    btn.disabled = false; label.textContent = 'Save a backup ZIP';
  }
}
