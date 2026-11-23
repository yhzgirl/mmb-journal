// Calendar: a month at a time. Days with entries are tinted; tap one to see them.
import * as journal from '../journal.js';
import { h, icon, pageHead, monthLabel } from '../ui.js';
import { entryCard } from './parts.js';

const pad = n => String(n).padStart(2, '0');
let remembered = null;   // keep the month when coming back from an entry

export default function calendarView(main) {
  const days = journal.byDay();
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  let { y, m, picked } = remembered || { y: now.getFullYear(), m: now.getMonth(), picked: null };

  const title = h('h2', { 'aria-live': 'polite' });
  const grid = h('div', { class: 'cal', role: 'grid', 'aria-labelledby': 'cal-title' });
  const list = h('div', { style: 'margin-top:16px' });
  const years = [...new Set([...days.keys()].map(d => Number(d.slice(0, 4))))].sort((a, b) => b - a);
  const yearBar = h('div', { class: 'cal-years seg', role: 'group', 'aria-label': 'Jump to year' });
  title.id = 'cal-title';

  main.append(pageHead('Calendar'),
    yearBar,
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => step(-1) }, icon('left')),
      title,
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => step(1) }, icon('right'))),
    grid, list);

  function step(d) { m += d; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } picked = null; draw(); }

  function draw() {
    remembered = { y, m, picked };
    title.textContent = monthLabel(y, m);
    yearBar.replaceChildren(...years.map(yr => h('button', { 'aria-pressed': String(yr === y), onclick: () => {
      // Jump to the latest month in that year that has an entry.
      const last = [...days.keys()].filter(d => d.startsWith(yr + '-')).sort().pop();
      y = yr; m = Number(last.slice(5, 7)) - 1; picked = null; draw();
    } }, String(yr))));

    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7;            // weeks start on Monday
    const count = new Date(y, m + 1, 0).getDate();
    const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('div', { class: 'dow', role: 'columnheader', 'aria-label': d }, d[0]));
    for (let i = 0; i < lead; i++) cells.push(h('button', { class: 'out', tabindex: '-1', 'aria-hidden': 'true' }));
    for (let d = 1; d <= count; d++) {
      const key = `${y}-${pad(m + 1)}-${pad(d)}`;
      const n = days.get(key)?.length || 0;
      const label = new Date(y, m, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (n ? `, ${n} entr${n > 1 ? 'ies' : 'y'}` : '');
      cells.push(h('button', { class: [n ? 'has' : '', key === todayKey ? 'today' : ''].join(' '), 'aria-label': label,
        'aria-pressed': String(picked === key), onclick: () => { picked = picked === key ? null : key; draw(); } },
        String(d), n ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null));
    }
    grid.replaceChildren(...cells);

    const inMonth = [...days.entries()].filter(([k]) => k.startsWith(`${y}-${pad(m + 1)}`));
    const shown = picked ? (days.get(picked) || []) : inMonth.flatMap(([, list]) => list);
    list.replaceChildren(
      h('p', { class: 'muted small result-count' }, picked
        ? (shown.length ? '' : 'No entries on this day.')
        : `${shown.length} entr${shown.length === 1 ? 'y' : 'ies'} in ${monthLabel(y, m)}`),
      ...shown.map(e => entryCard(e, { withYear: true })));
  }
  draw();
}
