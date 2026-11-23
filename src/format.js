// MMB Journal file format, version 1. See ../../journal-format.md.
// Shared by the importer, the backup ZIP and (later) the app itself, so there is
// one definition of what a valid entry looks like.

export const ENTRY_FORMAT = 'mmb-journal-entry';
export const JOURNAL_FORMAT = 'mmb-journal';
export const VERSION = 1;
export const MAX_MEDIA = 10;
export const DEFAULT_TIMEZONE = 'Europe/London';

export const MOODS = { 1: 'down', 2: 'sad', 3: 'neutral', 4: 'happy', 5: 'excited' };

export const MEDIA_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
};

/** A new, empty entry with every field present. */
export function newEntry(fields = {}) {
  const now = new Date().toISOString();
  return {
    format: ENTRY_FORMAT,
    version: VERSION,
    id: fields.id ?? newId(),
    date: fields.date ?? now,
    timezone: fields.timezone || DEFAULT_TIMEZONE,
    created: fields.created ?? now,
    updated: fields.updated ?? now,
    text: fields.text ?? '',
    tags: fields.tags ?? [],
    mood: fields.mood ?? null,
    favourite: fields.favourite ?? false,
    location: fields.location ?? null,
    weather: fields.weather ?? null,
    media: fields.media ?? [],
    deleted: fields.deleted ?? null,
    source: fields.source ?? null
  };
}

/** Random 20-character ID, the same shape as Journey's. */
export function newId() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, b => abc[b % abc.length]).join('');
}

/** Paths inside the journal folder (Dropbox, or a backup ZIP). */
export const paths = {
  journal: 'journal.json',
  index: 'index.json',
  entry: id => `entries/${id}/entry.json`,
  media: (id, file) => `entries/${id}/${file}`
};

/** The calendar day an entry belongs to, in the place it was written: "2017-01-15". */
export function localDay(entry) {
  const tz = safeTimezone(entry.timezone);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(entry.date));
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function safeTimezone(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return DEFAULT_TIMEZONE; }
}

/** Plain-text preview for the timeline and search (no HTML). */
export function previewText(html, max = 160) {
  const text = String(html)
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/blockquote)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/** One short line per entry: what index.json holds. */
export function indexLine(entry) {
  return {
    id: entry.id,
    date: entry.date,
    day: localDay(entry),
    timezone: entry.timezone,
    updated: entry.updated,
    preview: previewText(entry.text),
    words: wordCount(entry.text),
    tags: entry.tags,
    mood: entry.mood,
    favourite: entry.favourite,
    hasLocation: !!entry.location,
    media: entry.media.map(m => m.type.split('/')[0]),
    deleted: entry.deleted
  };
}

export function wordCount(html) {
  const t = previewText(html, Infinity);
  return t ? t.split(' ').length : 0;
}

export function buildIndex(entries) {
  return {
    format: 'mmb-journal-index',
    version: VERSION,
    built: new Date().toISOString(),
    entries: entries.map(indexLine).sort((a, b) => b.date.localeCompare(a.date))
  };
}

export function buildJournal(entries, existing = {}) {
  const tagCounts = {};
  for (const e of entries) for (const t of e.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  return {
    format: JOURNAL_FORMAT,
    version: VERSION,
    name: existing.name ?? 'MMB Journal',
    created: existing.created ?? new Date().toISOString(),
    tags: Object.keys(tagCounts).sort((a, b) => a.localeCompare(b)).map(name => ({ name })),
    places: existing.places ?? [],
    encryption: existing.encryption ?? null
  };
}

/** Returns a list of problems; an empty list means the entry is valid. */
export function validateEntry(e) {
  const p = [];
  const iso = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  if (e.format !== ENTRY_FORMAT) p.push('format');
  if (e.version !== VERSION) p.push('version');
  if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(e.id)) p.push('id');
  for (const k of ['date', 'created', 'updated']) if (!iso(e[k])) p.push(k);
  if (typeof e.timezone !== 'string' || safeTimezone(e.timezone) !== e.timezone) p.push('timezone');
  if (typeof e.text !== 'string') p.push('text');
  if (!Array.isArray(e.tags) || e.tags.some(t => typeof t !== 'string' || !t)) p.push('tags');
  if (e.mood !== null && !MOODS[e.mood]) p.push('mood');
  if (typeof e.favourite !== 'boolean') p.push('favourite');
  if (e.location !== null && !(Number.isFinite(e.location?.lat) && Number.isFinite(e.location?.lng)
    && Math.abs(e.location.lat) <= 90 && Math.abs(e.location.lng) <= 180)) p.push('location');
  if (e.weather !== null && typeof e.weather !== 'object') p.push('weather');
  if (!Array.isArray(e.media) || e.media.length > MAX_MEDIA) p.push('media');
  else e.media.forEach((m, i) => {
    if (!m.id || !m.file?.startsWith('media/') || !m.type || !Number.isInteger(m.bytes)) p.push(`media[${i}]`);
  });
  if (e.deleted !== null && !iso(e.deleted)) p.push('deleted');
  return p;
}
