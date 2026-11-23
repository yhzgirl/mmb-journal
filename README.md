# MMB Journal app

Michelle's own journal: a home-screen web app (Brave on Android) over a folder of plain JSON files in Dropbox. The file format is described in `journal-format.md`, next to this folder.

Live at https://yhzgirl.github.io/mmb-journal/. Install it from Brave's menu with **Install app**.

## Running it

It's plain files with no build step. Serve the folder over HTTP, for example `python3 -m http.server 8738`, and open http://localhost:8738. After changing any app file, run `node tools/build-sw.mjs`. That updates the offline file list and version in `sw.js`, which is how phones pick up the change.

To test Dropbox sync without a real account, run `node tools/mock-dropbox.mjs` and, in the browser console on localhost, `localStorage.setItem('mmb-mock-dropbox', 'http://localhost:8739')`. Serving the same folder at both http://localhost:8738 and http://127.0.0.1:8738 gives two separate "phones" to sync between. This only works on localhost.

## What's in v0.2

- **Encryption**: every entry, photo, video and thumbnail is encrypted on the phone with AES-256-GCM, using one random journal key. The key is locked three ways: by the PIN and by the fingerprint (both kept on the phone only), and by a 24-character **recovery key** (kept on the phone and in Dropbox's `journal.json`). A short PIN could be guessed by anyone with a copy of its lock, so that copy never leaves the phone. Journals from v0.1 are encrypted the first time the PIN is entered after updating.
- **Dropbox sync** to `Apps/MMB Journal/`: two-way, in the background, after each change, when the app opens and every 10 minutes. Dropbox holds the same encrypted bytes as the phone. If an entry was changed on two phones at once, the newer version wins and the other is kept in the bin. A run that's cut off carries on next time.
- **Restore on a new phone**: "Restore from Dropbox" on the welcome screen, using the recovery key. A phone that started its own journal can join the Dropbox one later (More → Dropbox), keeping its entries.
- **Fingerprint unlock** (passkey PRF), offered automatically on the lock screen.
- **Forgot PIN**: open with the recovery key and choose a new PIN. Erasing the phone's copy is the last resort.
- **New recovery key** from More. Other phones pick it up on their next sync.
- **Decrypt page** (`decrypt.html`): turns a Dropbox download of the folder into a plain backup ZIP with the recovery key alone. Works offline, needs nothing from the app.

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
- **PIN lock** (4 to 8 digits): asked for every time the app opens or comes back from the background, but not after choosing a photo or file. After 5 wrong tries there's a wait, starting at 30 seconds and doubling up to 15 minutes.
- **Offline**: opens from the copy saved on the phone and updates in the background.

## Files

| File | What it does |
|---|---|
| `index.html`, `manifest.json`, `sw.js` | The page, the home-screen app details, and offline support (`sw.js` is generated). |
| `styles/app.css` | All styles and the four themes. |
| `src/main.js` | Start-up, bottom navigation and page router. |
| `src/journal.js` | The journal in memory: saving, the bin, On This Day, days and tags. |
| `src/store.js` | The copy on the phone (IndexedDB), encrypted, with media stored under their journal paths. |
| `src/format.js` | The entry format (v1) and validation. See `journal-format.md`. |
| `src/lock.js` | The lock screen and the keys: PIN, fingerprint and recovery key, first-time encryption, and locking when the app goes to the background. |
| `src/crypto.js` | Encryption (Web Crypto only): the file format, key wrapping and recovery keys. Shared with the decrypt page. |
| `src/sync.js` | Two-way sync with Dropbox. |
| `src/dropbox.js`, `src/config.js` | Dropbox sign-in (PKCE) and file calls; the public App key. |
| `decrypt.html`, `src/decrypt.js` | The stand-alone decrypt page. |
| `tools/mock-dropbox.mjs` | A stand-in Dropbox for testing on this computer. |
| `src/rich-text.js` | The editor set-up, shared by reading and editing. |
| `src/views/*.js` | One file per page. |
| `src/import/journey.js` | Journey backup → entries. |
| `src/backup-zip.js` | Writes and reads MMB Journal backup ZIPs. |
| `src/media-info.js` | Photo width and height from file headers. |
| `src/vendor/` | fflate 0.8.2, marked 12.0.2 and a TipTap 3.32.2 bundle (`editor.js`, built by `tools/editor/`). All MIT, and kept here so the app loads nothing from other sites. |
| `tools/import-journey.mjs` | Converts a Journey ZIP on the computer and checks the result (14 checks; counts only). |
| `tools/build-sw.mjs` | Regenerates `sw.js`. |

## Next

Automatic weather and place names (needs a choice of weather service); mood tracker and stats; font choice including OpenDyslexic.
