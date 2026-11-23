# MMB Journal app

Michelle's own journal: a home-screen web app (Brave on Android) over a folder of plain JSON files in Dropbox. The file format is described in [`../journal-format.md`](../journal-format.md).

## Running it

It's plain files with no build step. Serve the folder over HTTP, for example `python3 -m http.server 8738`, and open http://localhost:8738. After changing any app file, run `node tools/build-sw.mjs`. That updates the offline file list and version in `sw.js`, which is how phones pick up the change.

## What's in v0.1

- **Journal timeline**, newest first and grouped by month, with **On this day** at the top. It shows the same date in earlier years; 29 Feb shows on 28 Feb in other years.
- **Entry page**: text, date, time, mood, weather, place, photos and videos (tap to enlarge), and tags.
- **Editor**:
  - Undo and redo, headings 1–6, bold, italic, underline and strikethrough, text colour, highlight.
  - Bullet, numbered and check lists, quotes, dividers, links, images from a web address, tables.
  - Backdating (date and time are shown in the timezone the entry was written in).
  - 5 moods, tags with suggestions, and up to 10 photos or videos with reordering.
  - Current location with a name for the place, and a star.
  - It warns before you leave with unsaved changes.
- **Calendar**: month grid starting on Monday, year shortcuts, tap a day to see its entries.
- **Search**: words, tag, mood, photos or videos, starred only.
- **Bin**: deleted entries are kept for 30 days, with restore.
- **Import**: a Journey backup or an MMB Journal backup ZIP, read on the phone with a summary before anything is saved.
- **Backup**: saves the whole journal as an MMB Journal backup ZIP.
- **Look**: four themes (Paper and Lilac, light; Midnight and Ink, dark) or Auto, plus text size and line spacing.
- **Offline**: opens from the copy saved on the phone and updates in the background.

## Files

| File | What it does |
|---|---|
| `index.html`, `manifest.json`, `sw.js` | The page, the home-screen app details, and offline support (`sw.js` is generated). |
| `styles/app.css` | All styles and the four themes. |
| `src/main.js` | Start-up, bottom navigation and page router. |
| `src/journal.js` | The journal in memory: saving, the bin, On This Day, days and tags. |
| `src/store.js` | The copy on the phone (IndexedDB), with media stored under their journal paths. |
| `src/format.js` | The entry format (v1) and validation. See [`../journal-format.md`](../journal-format.md). |
| `src/rich-text.js` | The editor set-up, shared by reading and editing. |
| `src/views/*.js` | One file per page. |
| `src/import/journey.js` | Journey backup → entries. |
| `src/backup-zip.js` | Writes and reads MMB Journal backup ZIPs. |
| `src/media-info.js` | Photo width and height from file headers. |
| `src/vendor/` | fflate 0.8.2, marked 12.0.2 and a TipTap 3.32.2 bundle (`editor.js`, built by `tools/editor/`). All MIT, and kept here so the app loads nothing from other sites. |
| `tools/import-journey.mjs` | Converts a Journey ZIP on the computer and checks the result (14 checks; counts only). |
| `tools/build-sw.mjs` | Regenerates `sw.js`. |

## Next (v0.2)

Dropbox sync, encrypted on the phone with one journal key that the passcode, fingerprint and recovery key can each unlock; passcode lock and auto-lock; automatic weather and place names; mood tracker and stats; font choice including OpenDyslexic.
