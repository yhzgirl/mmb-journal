// Search the text, filtered by tag, mood, photos/videos and stars.
import * as journal from '../journal.js';
import { h, pageHead, MOOD_FACE } from '../ui.js';
import { MOODS } from '../format.js';
import { entryCard } from './parts.js';

let remembered = { q: '', tag: '', mood: '', media: '', fav: false };

export default function searchView(main, { args }) {
  if (args[0] === 'tag' && args[1]) remembered = { q: '', tag: args[1], mood: '', media: '', fav: false };
  const s = remembered;

  const q = h('input', { type: 'search', class: 'input', id: 'q', placeholder: 'Search your journal', value: s.q, enterkeyhint: 'search', autocomplete: 'off' });
  const tag = h('select', { class: 'input', 'aria-label': 'Tag' }, h('option', { value: '' }, 'Any tag'),
    journal.tagCounts().map(([t, n]) => h('option', { value: t, selected: t === s.tag }, `${t} (${n})`)));
  const mood = h('select', { class: 'input', 'aria-label': 'Mood' }, h('option', { value: '' }, 'Any mood'),
    h('option', { value: 'none', selected: s.mood === 'none' }, 'No mood set'),
    Object.entries(MOODS).map(([n, l]) => h('option', { value: n, selected: s.mood === n }, `${MOOD_FACE[n]} ${l[0].toUpperCase() + l.slice(1)}`)));
  const media = h('select', { class: 'input', 'aria-label': 'Photos and videos' }, h('option', { value: '' }, 'With or without photos'),
    [['any', 'With photos or videos'], ['image', 'With photos'], ['video', 'With videos'], ['none', 'No photos or videos']]
      .map(([v, l]) => h('option', { value: v, selected: s.media === v }, l)));
  const fav = h('input', { type: 'checkbox', id: 'fav-only', checked: s.fav });
  const results = h('div');

  main.append(pageHead('Search'), h('label', { for: 'q', class: 'visually-hidden' }, 'Search'), q,
    h('div', { class: 'filters' }, tag, mood, media,
      h('label', { for: 'fav-only', class: 'row card', style: 'padding:0 12px;min-height:44px;font-weight:600' }, fav, '★ Starred only')),
    results);

  const run = () => {
    Object.assign(s, { q: q.value, tag: tag.value, mood: mood.value, media: media.value, fav: fav.checked });
    const words = s.q.toLowerCase().split(/\s+/).filter(Boolean);
    const anyFilter = words.length || s.tag || s.mood || s.media || s.fav;
    if (!anyFilter) { results.replaceChildren(h('p', { class: 'muted result-count' }, 'Type a word, or pick a tag or mood.')); return; }
    const found = journal.live().filter(e => {
      if (s.tag && !e.tags.includes(s.tag)) return false;
      if (s.mood === 'none' ? e.mood !== null : s.mood && e.mood !== Number(s.mood)) return false;
      if (s.media === 'any' && !e.media.length) return false;
      if (s.media === 'none' && e.media.length) return false;
      if ((s.media === 'image' || s.media === 'video') && !e.media.some(m => m.type.startsWith(s.media))) return false;
      if (s.fav && !e.favourite) return false;
      if (words.length) {
        const hay = (journal.plainText(e) + ' ' + e.tags.join(' ') + ' ' + (e.location?.name || '') + ' ' + (e.location?.address || '')).toLowerCase();
        if (!words.every(w => hay.includes(w))) return false;
      }
      return true;
    });
    results.replaceChildren(h('p', { class: 'muted small result-count', 'aria-live': 'polite' }, `${found.length} entr${found.length === 1 ? 'y' : 'ies'}`),
      ...found.slice(0, 100).map(e => entryCard(e, { withYear: true })),
      found.length > 100 ? h('p', { class: 'muted small' }, 'Showing the newest 100. Add a word or filter to narrow it down.') : null);
  };
  let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(run, 150); };
  for (const el of [tag, mood, media, fav]) el.onchange = run;
  run();
  if (!s.q && !s.tag) setTimeout(() => q.focus(), 50);
}
