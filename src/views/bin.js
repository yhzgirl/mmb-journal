// Deleted entries stay here for 30 days, then go for good.
import * as journal from '../journal.js';
import { h, pageHead, shortDate, toast } from '../ui.js';
import { previewText } from '../format.js';
import { backButton } from './parts.js';

export default function binView(main) {
  main.append(pageHead('Bin', backButton('#/more')));
  const list = h('div');
  main.append(h('p', { class: 'muted' }, 'Deleted entries are kept here for 30 days, then removed for good.'), list);
  const draw = () => {
    const items = journal.binned();
    if (!items.length) { list.replaceChildren(h('p', { class: 'empty muted' }, 'The bin is empty.')); return; }
    list.replaceChildren(...items.map(e => h('div', { class: 'card entry-card' },
      h('div', { class: 'meta' }, h('span', { class: 'day' }, shortDate(e, true)), h('span', {}, `${journal.binDaysLeft(e)} days left`)),
      h('p', { class: 'preview' }, previewText(e.text, 140) || '(no text)'),
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn secondary', onclick: async () => { await journal.restore(e.id); toast('Entry restored'); draw(); } }, 'Restore'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm('Delete this entry and its photos for good? This can\'t be undone.')) return;
          await journal.destroy(e.id); toast('Deleted for good'); draw();
        } }, 'Delete now')))));
  };
  draw();
}
