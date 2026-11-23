// Look-and-feel settings, kept on the phone.
import { getMeta, setMeta } from './store.js';

export const THEMES = [
  { id: 'auto', name: 'Auto', note: 'Paper by day, Midnight at night', dot: 'linear-gradient(135deg,#f7f6f2 50%,#1c0a33 50%)' },
  { id: 'paper', name: 'Paper', note: 'Light', dot: '#f7f6f2', bar: '#2e0857' },
  { id: 'lilac', name: 'Lilac', note: 'Light', dot: '#ede4fa', bar: '#4e1280' },
  { id: 'midnight', name: 'Midnight', note: 'Dark', dot: '#1c0a33', bar: '#1c0a33' },
  { id: 'ink', name: 'Ink', note: 'Dark', dot: '#121318', bar: '#121318' }
];
export const SIZES = [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']];
export const LEADINGS = [['normal', 'Normal'], ['relaxed', 'Relaxed'], ['loose', 'Loose']];

const DEFAULTS = { theme: 'auto', size: 'm', leading: 'normal' };
let current = { ...DEFAULTS };

export const settings = () => current;

export async function applySettings(changes) {
  if (changes) { current = { ...current, ...changes }; await setMeta('settings', current); }
  else current = { ...DEFAULTS, ...((await getMeta('settings').catch(() => null)) || {}) };
  const root = document.documentElement;
  root.dataset.theme = current.theme;
  root.dataset.size = current.size;
  root.dataset.leading = current.leading;
  const dark = current.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches;
  const bar = current.theme === 'auto' ? (dark ? '#1c0a33' : '#2e0857') : THEMES.find(t => t.id === current.theme)?.bar;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar || '#2e0857');
}
