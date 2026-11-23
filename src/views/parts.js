// Pieces shared by several pages.
import { h, icon, shortDate, timeOf, MOOD_FACE, thumbUrl, placeLabel } from '../ui.js';
import { previewText, paths, MOODS } from '../format.js';

/** A tappable summary of an entry: date, mood, preview, up to 3 thumbnails, tags. */
export function entryCard(e, { label, withYear = !!label } = {}) {
  const shown = e.media.slice(0, 3);
  const thumbs = shown.length ? h('div', { class: 'thumbs' }, shown.map((m, i) => {
    const extra = i === 2 && e.media.length > 3 ? e.media.length - 3 : 0;
    if (m.type.startsWith('video/')) return h('div', { class: 'thumb' }, icon('video', 'Video'));
    const img = h('img', { class: 'thumb', alt: '', loading: 'lazy', width: 72, height: 72 });
    thumbUrl(paths.media(e.id, m.file)).then(u => { if (u) img.src = u; });
    if (!extra) return img;
    return h('div', { style: 'position:relative' }, img,
      h('div', { class: 'thumb more', style: 'position:absolute;inset:0;background:rgba(0,0,0,.45);color:#fff' }, `+${extra}`));
  })) : null;
  const text = previewText(e.text, 220);
  return h('a', { class: 'card entry-card', href: `#/entry/${encodeURIComponent(e.id)}` },
    h('div', { class: 'meta' },
      label ? h('span', { class: 'years' }, label) : null,
      h('span', { class: 'day' }, shortDate(e, withYear)),
      h('span', {}, timeOf(e)),
      e.mood ? h('span', { title: MOODS[e.mood], 'aria-label': `Mood: ${MOODS[e.mood]}` }, MOOD_FACE[e.mood]) : null,
      e.favourite ? h('span', { class: 'star', 'aria-label': 'Starred' }, '★') : null,
      e.location ? h('span', { class: 'small' }, placeLabel(e.location).split(',')[0]) : null),
    text ? h('p', { class: 'preview' }, text) : h('p', { class: 'preview muted' }, e.media.length ? '' : '(empty entry)'),
    thumbs,
    e.tags.length ? h('div', { class: 'chips' }, e.tags.map(t => h('span', { class: 'chip' }, t))) : null);
}

export const backButton = (href = '#/') =>
  h('a', { class: 'icon-btn', href, 'aria-label': 'Back', onclick: ev => { if (history.length > 1 && href === 'back') { ev.preventDefault(); history.back(); } } }, icon('back'));
