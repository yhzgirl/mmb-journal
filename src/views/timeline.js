// The journal: On This Day at the top, then every entry newest first, by month.
import * as journal from '../journal.js';
import { h, pageHead, monthLabel } from '../ui.js';
import { localDay } from '../format.js';
import { entryCard } from './parts.js';

const PAGE = 40;

export default function timeline(main) {
  const entries = journal.live();
  main.append(pageHead('Journal'));

  if (!entries.length) {
    main.append(h('div', { class: 'empty' },
      h('h2', {}, 'Nothing here yet'),
      h('p', { class: 'muted' }, 'Write your first entry, or bring in your entries from Journey.'),
      h('div', { class: 'row', style: 'justify-content:center' },
        h('a', { class: 'btn', href: '#/new' }, 'Write an entry'),
        h('a', { class: 'btn secondary', href: '#/import' }, 'Import from Journey'))));
    return;
  }

  // On This Day: hidden when nothing matches.
  const otd = journal.onThisDay();
  if (otd.length) {
    main.append(h('section', { class: 'card otd', 'aria-labelledby': 'otd-h' },
      h('h2', { id: 'otd-h' }, 'On this day'),
      otd.map(({ entry, years }) => entryCard(entry, { label: years === 1 ? '1 year ago' : `${years} years ago` }))));
  }

  // Timeline, shown in pages of 40 so a long journal still opens instantly.
  const list = h('div');
  main.append(list);
  let shown = 0, lastMonth = '';
  const more = h('button', { class: 'btn ghost', style: 'width:100%' }, 'Show older entries');
  more.onclick = showMore;
  main.append(more);
  showMore();

  function showMore() {
    for (const e of entries.slice(shown, shown + PAGE)) {
      const d = localDay(e), month = d.slice(0, 7);
      if (month !== lastMonth) {
        list.append(h('h2', { class: 'month-label' }, monthLabel(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1)));
        lastMonth = month;
      }
      list.append(entryCard(e));
    }
    shown += PAGE;
    more.hidden = shown >= entries.length;
  }
}
