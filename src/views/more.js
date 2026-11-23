// More: look and feel, Dropbox, privacy, import, backup, bin and storage.
import * as journal from '../journal.js';
import { h, icon, pageHead, toast } from '../ui.js';
import { THEMES, SIZES, LEADINGS, settings, applySettings } from '../settings.js';
import { getMedia, storageUse, keepStorage } from '../store.js';
import { writeJournalZip } from '../backup-zip.js';
import { paths } from '../format.js';
import { changePin, fingerprintOn, fingerprintAvailable, setUpFingerprint, turnOffFingerprint, newRecoveryKey, adoptJournalKey, ui as lockUi } from '../lock.js';
import * as sync from '../sync.js';
import { startSignIn } from '../dropbox.js';

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

  const exportBtn = h('button', {}, h('span', { class: 'row' }, icon('download'), 'Save a backup ZIP'), h('span', { class: 'muted small' }, 'Plain files, not encrypted'));
  exportBtn.onclick = () => exportBackup(exportBtn);
  main.append(h('h2', { class: 'section-title' }, 'Your journal'),
    h('div', { class: 'card list' },
      h('a', { href: '#/import' }, h('span', { class: 'row' }, icon('upload'), 'Import'), h('span', { class: 'muted small' }, 'From Journey or a backup')),
      exportBtn,
      h('a', { href: '#/bin' }, h('span', { class: 'row' }, icon('bin'), 'Bin'), h('span', { class: 'muted small' }, `${journal.binned().length} entries`))));

  // Dropbox
  const dbBox = h('div', { class: 'card list' });
  const ago = iso => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const drawDb = () => {
    const s = sync.status();
    const rows = [];
    if (s.error && !s.needsKey) rows.push(h('div', { class: 'item sync-problem' }, h('span', {}, s.error)));
    if (!s.connected) {
      rows.push(h('button', { onclick: connectDropbox },
        h('span', { class: 'row' }, icon('cloud'), 'Connect Dropbox'), h('span', { class: 'muted small' }, 'Encrypted')));
    } else if (s.needsKey) {
      rows.push(h('div', { class: 'item' }, h('span', {}, 'Your Dropbox already has a journal. To add this phone\'s entries to it, open it with its recovery key.')),
        h('button', { onclick: openDropboxJournal }, h('span', { class: 'row' }, icon('key'), 'Enter its recovery key')),
        h('button', { onclick: disconnectDropbox }, 'Disconnect Dropbox'));
    } else {
      const p = s.progress;
      const state = s.running ? (p?.total ? `Syncing ${p.done + 1} of ${p.total}` : 'Syncing…') : s.lastSync ? `Synced ${ago(s.lastSync)}` : 'Not synced yet';
      rows.push(h('div', { class: 'item' }, h('span', { class: 'row' }, icon('cloud'), 'Dropbox'), h('span', {}, state)),
        h('button', { disabled: s.running, onclick: () => sync.syncNow() }, 'Sync now', s.waiting && !s.running ? h('span', { class: 'muted small' }, `${s.waiting} to send`) : null),
        h('button', { onclick: disconnectDropbox }, 'Disconnect Dropbox', h('span', { class: 'muted small' }, 'Files in Dropbox stay')));
    }
    dbBox.replaceChildren(...rows);
  };
  async function connectDropbox() {
    if (!confirm('You\'ll go to Dropbox to sign in and allow MMB Journal to use its own folder, Apps/MMB Journal. Everything is encrypted on this phone before it\'s sent. Carry on?')) return;
    await startSignIn('connect');
  }
  async function disconnectDropbox() {
    if (!confirm('Stop syncing with Dropbox on this phone? Your journal stays on this phone and in Dropbox.')) return;
    await sync.disconnect(); toast('Dropbox disconnected');
  }
  function openDropboxJournal() {
    const p = lockUi.panel({ onCancel: () => p.close() });
    p.body.append(lockUi.recoveryForm({
      heading: 'Join your Dropbox journal', button: 'Join',
      note: 'Type the recovery key for the journal in Dropbox. This phone will switch to that journal\'s key, and its entries will be added to Dropbox.',
      open: async text => {
        const checked = await sync.checkDropboxKey(text);
        p.close();
        if (await sync.joinDropboxJournal(checked, adoptJournalKey)) toast('Joined. Your recovery key is now the one you just typed.');
      }
    }));
  }
  const offStatus = sync.onStatus(drawDb);
  drawDb();
  main.append(h('h2', { class: 'section-title' }, 'Dropbox'), dbBox);

  // Privacy
  const pinBox = h('div', { class: 'card list' });
  const canFinger = await fingerprintAvailable();
  const drawPin = () => pinBox.replaceChildren(
    h('div', { class: 'item' }, h('span', { class: 'row' }, icon('lock'), 'PIN lock and encryption'), h('span', {}, 'On')),
    h('button', { onclick: async () => { if (await changePin()) toast('PIN changed'); } }, 'Change PIN'),
    canFinger ? h('button', { onclick: async () => {
      if (fingerprintOn()) { await turnOffFingerprint(); toast('Fingerprint unlock turned off'); }
      else {
        try { await setUpFingerprint(); toast('Fingerprint unlock is on'); }
        catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('Fingerprint unlock couldn\'t be set up: ' + e.message); }
      }
      drawPin();
    } }, h('span', { class: 'row' }, icon('fingerprint'), 'Fingerprint unlock'), h('span', { class: 'muted small' }, fingerprintOn() ? 'On · tap to turn off' : 'Off · tap to turn on')) : null,
    h('button', { onclick: async () => {
      if (!confirm('Make a new recovery key? Your current one will stop working, here and in Dropbox.')) return;
      if (await newRecoveryKey()) { toast('New recovery key saved'); sync.syncNow(); }
    } }, h('span', { class: 'row' }, icon('key'), 'New recovery key'), h('span', { class: 'muted small' }, 'If you\'ve lost yours')));
  drawPin();
  main.append(h('h2', { class: 'section-title' }, 'Privacy'), pinBox);

  const use = await storageUse();
  const kept = await keepStorage();
  main.append(h('h2', { class: 'section-title' }, 'On this phone'),
    h('div', { class: 'card list' },
      h('div', { class: 'item' }, 'Entries', h('span', {}, String(journal.count()))),
      use ? h('div', { class: 'item' }, 'Space used', h('span', {}, `${(use.used / 1e6).toFixed(0)} MB`)) : null,
      h('div', { class: 'item' }, 'Protected from clean-up', h('span', {}, kept ? 'Yes' : 'Not yet'))),
    h('p', { class: 'muted small', style: 'margin:16px 4px' }, 'Your journal is encrypted on this phone. A backup ZIP is not encrypted, so keep it somewhere safe.'));
  return offStatus;
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
