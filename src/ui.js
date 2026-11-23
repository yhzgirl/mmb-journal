// Small shared helpers: building elements, icons, dates, moods, weather, toasts,
// thumbnails and photo URLs. Entry text is only ever shown through the editor (in
// read-only mode) or as plain text, never inserted as raw HTML.

import { getThumb, getMedia } from './store.js';
import { MOODS, safeTimezone } from './format.js';

/** h('a', { href: '#/', class: 'x', onclick }, 'text', child, …) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;            // only ever used with our own SVG icons
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Icons: simple 24px line drawings, drawn for this app.
const P = {
  timeline: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8Z"/>',
  starFill: '<path fill="currentColor" d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  backspace: '<path d="M9 5h10.5a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7Z"/><path d="m12 9.5 5 5M17 9.5l-5 5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  video: '<rect x="3.5" y="6" width="12" height="12" rx="2.5"/><path d="m15.5 10.5 5-3v9l-5-3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  bullet: '<circle cx="5" cy="7" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="17" r="1.3" fill="currentColor"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10"/>',
  numbered: '<path d="M9.5 7h10M9.5 12h10M9.5 17h10M4 5.5h1.5V9M4 9h3M4 14.5c.4-.6 2.6-.8 2.6.4 0 1-2.6 1.6-2.6 3h2.8"/>',
  check: '<rect x="3.5" y="4.5" width="6" height="6" rx="1.5"/><path d="m4.8 7.6 1.3 1.3 2.3-2.6M12.5 7.5h8M3.5 15.5h6v-.1M12.5 16.5h8"/><rect x="3.5" y="13.5" width="6" height="6" rx="1.5"/>',
  quote: '<path d="M6 17c-1.5 0-2.5-1.2-2.5-3 0-3 2-6 5-7M15 17c-1.5 0-2.5-1.2-2.5-3 0-3 2-6 5-7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15"/>',
  rule: '<path d="M4 12h16"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.3 0 1.8-1 1.3-2-.6-1.3.2-2.5 1.6-2.5h2.2a3.4 3.4 0 0 0 3.4-3.4c0-5-3.8-9.1-8.5-9.1Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7.5" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.2" fill="currentColor"/>',
  marker: '<path d="m14 4 6 6-8.5 8.5H5.5v-6Z"/><path d="M4 21h16"/>',
  bin: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3.5h16V16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 16v3.5h16V16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'
};
export function icon(name, label) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.innerHTML = `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${P[name] || ''}</svg>`;
  return span.firstChild;
}

// ---------- dates ----------
const fmtCache = new Map();
function fmt(tz, opts) {
  const key = tz + JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-GB', { timeZone: safeTimezone(tz), ...opts }));
  return fmtCache.get(key);
}
export const longDate = e => fmt(e.timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(e.date));
export const shortDate = (e, withYear) => fmt(e.timezone, { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(e.date));
export const timeOf = e => fmt(e.timezone, { hour: '2-digit', minute: '2-digit' }).format(new Date(e.date));
export const monthLabel = (y, m) => new Date(Date.UTC(y, m, 15)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';

/** "2017-01-29T20:31" wall-clock time of an instant in a timezone (for <input type=datetime-local>). */
export function toLocalInput(iso, tz) {
  const p = Object.fromEntries(fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** The instant (ISO, UTC) for a wall-clock time in a timezone. */
export function fromLocalInput(local, tz) {
  const [d, t = '00:00'] = local.split('T');
  const [y, mo, da] = d.split('-').map(Number), [hh, mm] = t.split(':').map(Number);
  let guess = Date.UTC(y, mo - 1, da, hh, mm);
  for (let i = 0; i < 2; i++) {               // correct for the timezone offset (twice for DST edges)
    const shown = toLocalInput(new Date(guess).toISOString(), tz);
    const [sd, st] = shown.split('T'); const [sy, smo, sda] = sd.split('-').map(Number); const [sh, sm] = st.split(':').map(Number);
    guess += Date.UTC(y, mo - 1, da, hh, mm) - Date.UTC(sy, smo - 1, sda, sh, sm);
  }
  return new Date(guess).toISOString();
}

// ---------- mood & weather ----------
export const MOOD_FACE = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };
export const moodLabel = m => (m ? `${MOOD_FACE[m]} ${MOODS[m][0].toUpperCase()}${MOODS[m].slice(1)}` : '');
const WEATHER_FACE = { 'clear-day': '☀️', 'clear-night': '🌙', 'partly-cloudy-day': '⛅', 'partly-cloudy-night': '☁️',
  cloudy: '☁️', overcast: '☁️', showers: '🌦️', rain: '🌧️', thunder: '⛈️', snow: '❄️', fog: '🌫️' };
export const weatherLabel = w => w ? `${WEATHER_FACE[w.icon] || '🌡️'} ${Math.round(w.tempC)}°C${w.description ? ' · ' + w.description : ''}` : '';
export const placeLabel = l => l ? (l.name || l.address || `${l.lat.toFixed(3)}, ${l.lng.toFixed(3)}`) : '';

// ---------- photos ----------
const urlCache = new Map();
/** Object URL for a stored thumbnail (or full image if there's no thumbnail). Cached for the session. */
export async function thumbUrl(path) {
  if (urlCache.has('t:' + path)) return urlCache.get('t:' + path);
  const blob = (await getThumb(path)) || (await getMedia(path));
  const url = blob ? URL.createObjectURL(blob) : null;
  urlCache.set('t:' + path, url);
  return url;
}
export async function mediaUrl(path) {
  if (urlCache.has('m:' + path)) return urlCache.get('m:' + path);
  const blob = await getMedia(path);
  const url = blob ? URL.createObjectURL(blob) : null;
  urlCache.set('m:' + path, url);
  return url;
}
export function forgetUrls(path) {
  for (const k of ['t:' + path, 'm:' + path]) { const u = urlCache.get(k); if (u) URL.revokeObjectURL(u); urlCache.delete(k); }
}

/** A small JPEG (longest side 480px) for lists. Returns null for videos or if it fails. */
export async function makeThumb(blob) {
  if (!blob.type.startsWith('image/')) return null;
  try {
    const probe = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / Math.max(probe.width, probe.height));
    const w = Math.max(1, Math.round(probe.width * scale)), hgt = Math.max(1, Math.round(probe.height * scale));
    probe.close?.();
    const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: hgt, resizeQuality: 'high' });
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, hgt) : Object.assign(document.createElement('canvas'), { width: w, height: hgt });
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    return canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
      : await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
  } catch { return null; }
}

// ---------- toast ----------
let toastTimer;
export function toast(message, action) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message,
    action && h('button', { onclick: () => { el.remove(); action.run(); } }, action.label));
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 3000);
}

export function pageHead(title, ...right) {
  return h('div', { class: 'page-head' }, h('h1', { tabindex: '-1' }, title), h('div', { class: 'row' }, ...right));
}
