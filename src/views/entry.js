// Reading one entry.
import * as journal from '../journal.js';
import { h, icon, longDate, timeOf, moodLabel, weatherLabel, placeLabel, thumbUrl, mediaUrl, toast } from '../ui.js';
import { paths } from '../format.js';
import { createEditor } from '../rich-text.js';
import { backButton } from './parts.js';

export default function entryView(main, { args: [id] }) {
  const e = journal.get(id);
  if (!e) { main.append(h('div', { class: 'empty' }, h('h2', {}, 'Entry not found'), h('a', { class: 'btn', href: '#/' }, 'Back to the journal'))); return; }

  const starBtn = h('button', { class: 'icon-btn', 'aria-pressed': String(e.favourite), 'aria-label': e.favourite ? 'Unstar' : 'Star',
    style: e.favourite ? 'color:var(--highlight)' : '' }, icon(e.favourite ? 'starFill' : 'star'));
  starBtn.onclick = async () => {
    const cur = journal.get(id);
    await journal.save({ ...cur, favourite: !cur.favourite, updated: new Date().toISOString() });
    const on = !cur.favourite;
    starBtn.replaceChildren(icon(on ? 'starFill' : 'star'));
    starBtn.setAttribute('aria-pressed', String(on)); starBtn.setAttribute('aria-label', on ? 'Unstar' : 'Star');
    starBtn.style.color = on ? 'var(--highlight)' : '';
  };
  const deleteBtn = h('button', { class: 'icon-btn', 'aria-label': 'Delete' }, icon('trash'));
  deleteBtn.onclick = async () => {
    await journal.moveToBin(id);
    location.hash = '#/';
    toast('Moved to the bin for 30 days', { label: 'Undo', run: async () => { await journal.restore(id); location.hash = `#/entry/${encodeURIComponent(id)}`; } });
  };

  main.append(h('div', { class: 'editor-bar' },
    backButton('#/'),
    h('div', { class: 'row' }, starBtn, deleteBtn,
      h('a', { class: 'btn', href: `#/edit/${encodeURIComponent(id)}` }, icon('edit'), 'Edit'))));

  if (e.deleted) main.append(h('p', { class: 'card', style: 'padding:12px 16px' }, `This entry is in the bin. `,
    h('button', { class: 'btn secondary', onclick: async () => { await journal.restore(id); location.reload(); } }, 'Restore it')));

  main.append(h('header', { class: 'entry-head' },
    h('h1', { class: 'when', tabindex: '-1' }, longDate(e)),
    h('div', { class: 'facts' },
      h('span', {}, timeOf(e)),
      e.mood ? h('span', {}, moodLabel(e.mood)) : null,
      e.weather ? h('span', {}, weatherLabel(e.weather)) : null,
      e.location ? h('span', {}, icon('pin'), placeLabel(e.location)) : null)));

  const body = h('div');
  main.append(body);
  const editor = createEditor(body, { html: e.text, editable: false });

  if (e.media.length) main.append(gallery(e));
  if (e.tags.length) main.append(h('div', { class: 'chips', style: 'margin-top:16px' },
    e.tags.map(t => h('a', { class: 'chip', href: `#/search/tag/${encodeURIComponent(t)}` }, t))));

  return () => editor.destroy();
}

function gallery(e) {
  const single = e.media.length === 1;
  return h('div', { class: 'gallery' }, e.media.map(m => {
    const p = paths.media(e.id, m.file);
    if (m.type.startsWith('video/')) {
      const v = h('video', { controls: true, preload: 'metadata', playsinline: true, class: single ? 'single' : '' });
      mediaUrl(p).then(u => { if (u) v.src = u; });
      return v;
    }
    const img = h('img', { alt: m.caption || '', loading: 'lazy', class: single ? 'single' : '',
      width: m.width || undefined, height: m.height || undefined });
    (single ? mediaUrl(p) : thumbUrl(p)).then(u => { if (u) img.src = u; });
    img.onclick = () => lightbox(p);
    return img;
  }));
}

async function lightbox(path) {
  const url = await mediaUrl(path);
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = ev => { if (ev.key === 'Escape') close(); };
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Photo', onclick: ev => { if (ev.target === box) close(); } },
    h('img', { src: url, alt: '' }),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close')));
  document.body.append(box);
  document.addEventListener('keydown', onKey);
  box.querySelector('button').focus();
}
