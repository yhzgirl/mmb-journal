// Turns a Journey backup ZIP into MMB Journal entries (format v1).
// Runs the same way in the browser (on the phone) and in Node (for testing).
//
//   const result = convertJourneyZip(zipBytes);
//   result.entries   – array of entries, newest first
//   result.files     – Map of path in the journal folder → Uint8Array (media only)
//   result.report    – counts and warnings, with no entry text in it

import { unzipSync } from '../vendor/fflate.js';
import { marked } from '../vendor/marked.esm.js';
import { newEntry, validateEntry, MEDIA_TYPES, MAX_MEDIA, DEFAULT_TIMEZONE, safeTimezone, paths } from '../format.js';
import { imageSize } from '../media-info.js';

// Journey's mood values, from its own code: down .25, sad .75, neutral 1, happy 1.25, excited 1.75.
const MOOD_FROM_SENTIMENT = [[0.25, 1], [0.75, 2], [1, 3], [1.25, 4], [1.75, 5]];

// OpenWeatherMap icon codes (what Journey stores) → plain names.
const WEATHER_ICONS = { '01': 'clear', '02': 'partly-cloudy', '03': 'cloudy', '04': 'overcast',
  '09': 'showers', '10': 'rain', '11': 'thunder', '13': 'snow', '50': 'fog' };

export function moodFromSentiment(s) {
  if (typeof s !== 'number' || s <= 0) return null;
  let best = MOOD_FROM_SENTIMENT[0];
  for (const pair of MOOD_FROM_SENTIMENT) if (Math.abs(pair[0] - s) < Math.abs(best[0] - s)) best = pair;
  return best[1];
}

export function weatherIcon(code) {
  if (typeof code !== 'string') return null;
  const name = WEATHER_ICONS[code.slice(0, 2)];
  if (!name) return null;
  // Day and night only look different for clear and partly cloudy skies.
  return (name === 'clear' || name === 'partly-cloudy') ? `${name}-${code.endsWith('n') ? 'night' : 'day'}` : name;
}

const textDecoder = new TextDecoder();

export function convertJourneyZip(zipBytes, { importedAt = new Date().toISOString() } = {}) {
  const all = unzipSync(zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes));

  // Group files by their folder. Journey puts each entry in <id>/<id>.json, with
  // its photos and videos beside it. unzipSync keeps the ZIP's own file order.
  const folders = new Map();
  for (const [path, bytes] of Object.entries(all)) {
    if (path.endsWith('/') || path.split('/').some(p => p.startsWith('.') || p === '__MACOSX')) continue;
    const parts = path.split('/');
    const name = parts.pop(), folder = parts.join('/');
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push({ name, bytes });
  }

  const report = {
    entries: 0, html: 0, markdown: 0, withMood: 0, favourites: 0, withLocation: 0, withWeather: 0,
    withTags: 0, tags: 0, timezoneDefaulted: 0, media: { image: 0, video: 0, other: 0 }, mediaBytes: 0,
    entriesWithMedia: 0, entriesWithSeveralMedia: 0, dateRange: null, warnings: []
  };
  const entries = [], files = new Map();

  for (const [folder, list] of folders) {
    const id = folder.split('/').pop();
    const jsonFile = list.find(f => f.name === `${id}.json`);
    if (!jsonFile) continue;                      // not an entry folder
    let j;
    try { j = JSON.parse(textDecoder.decode(jsonFile.bytes)); }
    catch { report.warnings.push(`Entry ${id}: its JSON could not be read, so it was skipped.`); continue; }

    // Text: Journey stores HTML, or Markdown for some older entries.
    let text = typeof j.text === 'string' ? j.text : '';
    if (j.type === 'markdown') { text = marked.parse(text, { gfm: true, breaks: true }).trim(); report.markdown++; }
    else report.html++;

    // Timezone
    let timezone = j.timezone;
    if (!timezone || safeTimezone(timezone) !== timezone) { timezone = DEFAULT_TIMEZONE; report.timezoneDefaulted++; }

    // Location: Journey uses {} for none.
    const loc = j.location || {};
    const location = Number.isFinite(loc.lat) && Number.isFinite(loc.lng) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180
      ? { lat: loc.lat, lng: loc.lng, name: null, address: j.address || null }
      : null;

    // Weather
    const w = j.weather || {};
    const weather = typeof w.degreeC === 'number'
      ? { tempC: Math.round(w.degreeC * 10) / 10, description: w.description || null, icon: weatherIcon(w.icon), place: w.place || null }
      : null;

    // Media: everything in the folder except the JSON, in ZIP order.
    const media = [];
    for (const f of list) {
      if (f === jsonFile) continue;
      const dot = f.name.lastIndexOf('.');
      const ext = dot > 0 ? f.name.slice(dot + 1).toLowerCase() : '';
      const type = MEDIA_TYPES[ext];
      if (!type) { report.warnings.push(`Entry ${id}: skipped a file of an unknown type (.${ext || 'no extension'}).`); report.media.other++; continue; }
      const mediaId = (dot > 0 ? f.name.slice(0, dot) : f.name).replace(/[^A-Za-z0-9_-]/g, '_');
      const file = `media/${mediaId}.${ext === 'jpeg' ? 'jpg' : ext}`;
      const size = type.startsWith('image/') ? imageSize(f.bytes) : null;
      media.push({ id: mediaId, file, type, width: size?.width ?? null, height: size?.height ?? null, bytes: f.bytes.length, caption: null });
      files.set(paths.media(id, file), f.bytes);
      report.media[type.split('/')[0]]++;
      report.mediaBytes += f.bytes.length;
    }
    if (media.length > MAX_MEDIA) report.warnings.push(`Entry ${id}: has ${media.length} photos/videos; the app shows up to ${MAX_MEDIA}, but all are kept.`);
    if (media.length) report.entriesWithMedia++;
    if (media.length > 1) report.entriesWithSeveralMedia++;

    const mood = moodFromSentiment(j.sentiment);
    if (typeof j.sentiment === 'number' && j.sentiment > 0 && !MOOD_FROM_SENTIMENT.some(([v]) => v === j.sentiment)) {
      report.warnings.push(`Entry ${id}: unusual mood value ${j.sentiment}, matched to the nearest mood.`);
    }

    const tags = Array.isArray(j.tags) ? [...new Set(j.tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean))] : [];
    const updated = isoOr(j.updatedAt, j.dateOfJournal);

    const entry = newEntry({
      id,
      date: isoOr(j.dateOfJournal, updated),
      timezone,
      created: updated,
      updated,
      text,
      tags,
      mood,
      favourite: !!j.favourite,
      location,
      weather,
      media,
      source: {
        app: 'Journey',
        id,
        importedAt,
        // Fields the new app doesn't show, kept so nothing from the backup is lost.
        journey: {
          type: j.type ?? null, sentiment: j.sentiment ?? null, activity: j.activity ?? null,
          music: j.music ?? null, weatherId: w.id ?? null, weatherIcon: w.icon ?? null,
          version: j.version ?? null, schemaVersion: j.schemaVersion ?? null
        }
      }
    });

    const problems = validateEntry(entry).filter(p => p !== 'media'); // >10 media is reported above, not fatal
    if (problems.length) report.warnings.push(`Entry ${id}: problem with ${problems.join(', ')}.`);

    report.entries++;
    if (mood) report.withMood++;
    if (entry.favourite) report.favourites++;
    if (location) report.withLocation++;
    if (weather) report.withWeather++;
    if (tags.length) report.withTags++;
    report.tags += tags.length;
    entries.push(entry);
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));
  if (entries.length) report.dateRange = [entries[entries.length - 1].date.slice(0, 10), entries[0].date.slice(0, 10)];
  report.distinctTags = new Set(entries.flatMap(e => e.tags)).size;
  return { entries, files, report };
}

function isoOr(value, fallback) {
  const t = Date.parse(value);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  const f = Date.parse(fallback);
  return Number.isNaN(f) ? new Date().toISOString() : new Date(f).toISOString();
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const monthYear = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A short, plain-English summary for the import screen. */
export function describeReport(r) {
  const lines = [
    `${plural(r.entries, 'entry', 'entries')}${r.dateRange ? `, ${monthYear(r.dateRange[0])} to ${monthYear(r.dateRange[1])}` : ''}`,
    `${plural(r.media.image, 'photo')} and ${plural(r.media.video, 'video')} (${(r.mediaBytes / 1e6).toFixed(1)} MB) in ${plural(r.entriesWithMedia, 'entry', 'entries')}`,
    `${r.withMood} with a mood · ${r.withLocation} with a place · ${r.withWeather} with weather · ${r.favourites} starred`,
    `${plural(r.distinctTags, 'tag')}, used ${plural(r.tags, 'time')}`
  ];
  if (r.markdown) lines.push(`${plural(r.markdown, 'older entry', 'older entries')} converted from Markdown`);
  if (r.timezoneDefaulted) lines.push(`${plural(r.timezoneDefaulted, 'entry', 'entries')} with no timezone, set to ${DEFAULT_TIMEZONE}`);
  if (r.entriesWithSeveralMedia) lines.push(`${plural(r.entriesWithSeveralMedia, 'entry has', 'entries have')} several photos. Journey didn't save their order, so check it after importing.`);
  return lines;
}
