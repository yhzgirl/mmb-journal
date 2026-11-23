// Writing and editing an entry.
import * as journal from '../journal.js';
import { h, icon, toast, toLocalInput, fromLocalInput, deviceTimezone, MOOD_FACE, thumbUrl, placeLabel } from '../ui.js';
import { newEntry, newId, paths, MOODS, MAX_MEDIA } from '../format.js';
import { imageSize } from '../media-info.js';
import { createEditor, TEXT_COLOURS, HIGHLIGHTS } from '../rich-text.js';
import { setLeaveGuard } from '../main.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };

export default function editorView(main, { name, args: [id] }) {
  const original = name === 'edit' ? journal.get(id) : null;
  if (name === 'edit' && !original) { main.append(h('p', { class: 'empty' }, 'Entry not found.')); return; }

  const tz = original?.timezone || deviceTimezone();
  const draft = structuredClone(original || newEntry({ timezone: tz }));
  const newMedia = new Map();          // file → Blob, for photos added in this edit
  const removed = [];                  // files taken out
  const localUrls = [];
  let dirty = false, textChanged = false, saving = false;
  const touch = () => { dirty = true; };

  setLeaveGuard(() => !dirty || saving || confirm('Leave without saving your changes?'));

  // ---------- top bar ----------
  const saveBtn = h('button', { class: 'btn' }, 'Save');
  main.append(h('div', { class: 'editor-bar' },
    h('a', { class: 'btn ghost', href: original ? `#/entry/${encodeURIComponent(id)}` : '#/' }, 'Cancel'),
    h('h1', { class: 'visually-hidden', tabindex: '-1' }, original ? 'Edit entry' : 'New entry'),
    saveBtn));

  // ---------- date & time (backdating) ----------
  const when = h('input', { type: 'datetime-local', class: 'input', id: 'when', value: toLocalInput(draft.date, tz), required: true });
  when.onchange = () => { if (when.value) { draft.date = fromLocalInput(when.value, tz); touch(); } };
  main.append(h('div', { class: 'field' }, h('label', { for: 'when' }, 'Date and time'), when,
    tz !== deviceTimezone() ? h('span', { class: 'muted small' }, `Time shown in ${tz.replace(/_/g, ' ')}, where this was written.`) : null));

  // ---------- text ----------
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' });
  const surface = h('div', { class: 'card editor-surface' });
  main.append(toolbar, surface);
  const editor = createEditor(surface, {
    html: draft.text, editable: true, placeholder: 'What happened today?',
    onUpdate: () => { textChanged = true; touch(); }
  });
  buildToolbar(toolbar, editor);
  if (!original) setTimeout(() => editor.commands.focus('end'), 50);

  // ---------- mood ----------
  const moods = h('div', { class: 'moods', role: 'group', 'aria-label': 'Mood' });
  const drawMoods = () => moods.replaceChildren(...Object.entries(MOODS).map(([n, label]) => {
    const on = draft.mood === Number(n);
    return h('button', { type: 'button', 'aria-pressed': String(on), onclick: () => { draft.mood = on ? null : Number(n); touch(); drawMoods(); } },
      h('span', { 'aria-hidden': 'true' }, MOOD_FACE[n]), label[0].toUpperCase() + label.slice(1));
  }));
  drawMoods();
  main.append(h('div', { class: 'field' }, h('span', { class: 'label' }, 'Mood'), moods));

  // ---------- tags ----------
  const tagBox = h('div', { class: 'tag-editor' });
  const tagInput = h('input', { class: 'input', id: 'tag-input', list: 'tag-list', placeholder: 'Add a tag', autocomplete: 'off', enterkeyhint: 'done', style: 'flex:1;min-width:140px' });
  const tagList = h('datalist', { id: 'tag-list' }, journal.tagCounts().map(([t]) => h('option', { value: t })));
  const addTag = () => {
    for (const t of tagInput.value.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!draft.tags.some(x => x.toLowerCase() === t.toLowerCase())) { draft.tags.push(t); touch(); }
    }
    tagInput.value = ''; drawTags();
  };
  tagInput.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); addTag(); } };
  tagInput.onchange = addTag;
  const drawTags = () => tagBox.replaceChildren(...draft.tags.map(t => h('span', { class: 'chip' }, t,
    h('button', { type: 'button', 'aria-label': `Remove tag ${t}`, onclick: () => { draft.tags = draft.tags.filter(x => x !== t); touch(); drawTags(); } }, '×'))), tagInput);
  drawTags();
  main.append(h('div', { class: 'field' }, h('label', { for: 'tag-input' }, 'Tags'), tagBox, tagList));

  // ---------- photos & videos ----------
  const mediaList = h('div', { class: 'media-editor' });
  const fileInput = h('input', { type: 'file', accept: 'image/*,video/*', multiple: true, id: 'add-media', class: 'visually-hidden' });
  const addLabel = h('label', { class: 'btn secondary', for: 'add-media' }, icon('photo'), 'Add photos or videos');
  fileInput.onchange = async () => {
    const files = [...fileInput.files]; fileInput.value = '';
    let skipped = 0;
    for (const f of files) {
      if (draft.media.length >= MAX_MEDIA) { toast(`An entry can have up to ${MAX_MEDIA} photos and videos`); break; }
      const ext = EXT[f.type];
      if (!ext) { skipped++; continue; }
      const mid = newId().slice(0, 12), file = `media/${mid}.${ext}`;
      let size = null;
      if (f.type.startsWith('image/')) {
        size = imageSize(new Uint8Array(await f.slice(0, 512 * 1024).arrayBuffer()));
        if (!size) { try { const b = await createImageBitmap(f); size = { width: b.width, height: b.height }; b.close?.(); } catch { /* fine */ } }
      }
      draft.media.push({ id: mid, file, type: f.type, width: size?.width ?? null, height: size?.height ?? null, bytes: f.size, caption: null });
      newMedia.set(file, f);
      touch();
    }
    if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped: only JPEG, PNG, WebP, GIF, MP4, MOV and WebM work`);
    drawMedia();
  };
  const drawMedia = () => {
    mediaList.replaceChildren(...draft.media.map((m, i) => {
      const img = m.type.startsWith('image/') ? h('img', { class: 'thumb', alt: '' }) : h('div', { class: 'thumb' }, icon('video', 'Video'));
      if (img.tagName === 'IMG') {
        if (newMedia.has(m.file)) { const u = URL.createObjectURL(newMedia.get(m.file)); localUrls.push(u); img.src = u; }
        else thumbUrl(paths.media(draft.id, m.file)).then(u => { if (u) img.src = u; });
      }
      const move = (to) => { const [x] = draft.media.splice(i, 1); draft.media.splice(to, 0, x); touch(); drawMedia(); };
      return h('div', { class: 'media-item' }, img,
        h('div', { class: 'grow' }, `${m.type.startsWith('video/') ? 'Video' : 'Photo'} ${i + 1}`, m.width ? ` · ${m.width}×${m.height}` : '', ` · ${m.bytes < 1e6 ? Math.max(1, Math.round(m.bytes / 1e3)) + ' KB' : (m.bytes / 1e6).toFixed(1) + ' MB'}`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${i + 1} up`, disabled: i === 0, onclick: () => move(i - 1) }, icon('up')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Move ${i + 1} down`, disabled: i === draft.media.length - 1, onclick: () => move(i + 1) }, icon('down')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${i + 1}`, onclick: () => {
          draft.media.splice(i, 1);
          if (newMedia.has(m.file)) newMedia.delete(m.file); else removed.push(m.file);
          touch(); drawMedia();
        } }, icon('close')));
    }));
    addLabel.hidden = draft.media.length >= MAX_MEDIA;
  };
  drawMedia();
  main.append(h('div', { class: 'field' }, h('span', { class: 'label' }, `Photos and videos (up to ${MAX_MEDIA})`), mediaList, h('div', {}, addLabel, fileInput)));

  // ---------- place ----------
  const placeBox = h('div', { class: 'field' });
  const drawPlace = () => {
    const loc = draft.location;
    const locate = h('button', { type: 'button', class: 'btn secondary' }, icon('pin'), loc ? 'Use where I am now' : 'Add where I am');
    locate.onclick = () => {
      if (!navigator.geolocation) return toast('This browser can\'t share your location');
      locate.disabled = true; locate.lastChild.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition(pos => {
        draft.location = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), name: draft.location?.name ?? null, address: null };
        touch(); drawPlace();
        if (pos.coords.accuracy > 500) toast(`Place found to within about ${Math.round(pos.coords.accuracy / 100) / 10} km`);
      }, err => { toast(err.code === 1 ? 'Location permission was turned down' : 'Couldn\'t find your location'); drawPlace(); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    };
    const nameInput = loc ? h('input', { class: 'input', id: 'place-name', value: loc.name || '', placeholder: loc.address || 'e.g. Home, Mum\'s, Lanzarote' }) : null;
    if (nameInput) nameInput.oninput = () => { draft.location = { ...draft.location, name: nameInput.value.trim() || null }; touch(); };
    placeBox.replaceChildren(
      h('span', { class: 'label' }, 'Place'),
      loc ? h('div', { class: 'muted small' }, placeLabel({ ...loc, name: null })) : null,
      loc ? h('label', { for: 'place-name', class: 'small' }, 'Name for this place') : null, nameInput,
      h('div', { class: 'row' }, locate,
        loc ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { draft.location = null; touch(); drawPlace(); } }, 'Remove place') : null));
  };
  drawPlace();
  main.append(placeBox);

  // ---------- star ----------
  const fav = h('input', { type: 'checkbox', id: 'fav', checked: draft.favourite });
  fav.onchange = () => { draft.favourite = fav.checked; touch(); };
  main.append(h('div', { class: 'field' }, h('label', { class: 'row', for: 'fav', style: 'font-weight:600' }, fav, '★ Star this entry')));

  // ---------- save ----------
  saveBtn.onclick = async () => {
    if (!original && editor.isEmpty && !draft.media.length) { toast('Write something or add a photo first'); return; }
    saving = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const now = new Date().toISOString();
    if (textChanged || !original) draft.text = editor.isEmpty ? '' : editor.getHTML();
    draft.updated = now;
    if (!original) draft.created = now;
    try {
      await journal.save(draft, { newMedia: [...newMedia].map(([file, blob]) => ({ file, blob })), removed });
      dirty = false; setLeaveGuard(null);
      location.replace(`#/entry/${encodeURIComponent(draft.id)}`);
    } catch (err) {
      saving = false; saveBtn.disabled = false; saveBtn.textContent = 'Save';
      toast('Couldn\'t save: ' + err.message);
    }
  };

  return () => { editor.destroy(); localUrls.forEach(u => URL.revokeObjectURL(u)); };
}

// ---------- formatting toolbar ----------
function buildToolbar(bar, editor) {
  const items = [];
  const btn = (label, iconName, run, isOn, text) => {
    const b = h('button', { type: 'button', 'aria-label': label, title: label }, iconName ? icon(iconName) : text);
    b.onmousedown = ev => ev.preventDefault();        // keep the text selection
    b.onclick = () => run(editor.chain().focus());
    items.push({ b, isOn });
    return b;
  };
  const sep = () => h('span', { class: 'sep', 'aria-hidden': 'true' });

  const heading = h('select', { 'aria-label': 'Text style', class: 'input', style: 'flex:none;width:auto;min-height:40px;padding:4px 8px;border:0;background:transparent;font-weight:700' },
    h('option', { value: '0' }, 'Text'), [1, 2, 3, 4, 5, 6].map(n => h('option', { value: String(n) }, `Heading ${n}`)));
  heading.onchange = () => {
    const n = Number(heading.value);
    n ? editor.chain().focus().setHeading({ level: n }).run() : editor.chain().focus().setParagraph().run();
  };

  const tableTools = h('span', { style: 'display:contents' });
  bar.append(
    btn('Undo', 'undo', c => c.undo().run()), btn('Redo', 'redo', c => c.redo().run()), sep(),
    heading,
    btn('Bold', null, c => c.toggleBold().run(), () => editor.isActive('bold'), h('b', {}, 'B')),
    btn('Italic', null, c => c.toggleItalic().run(), () => editor.isActive('italic'), h('i', {}, 'I')),
    btn('Underline', null, c => c.toggleUnderline().run(), () => editor.isActive('underline'), h('u', {}, 'U')),
    btn('Strikethrough', null, c => c.toggleStrike().run(), () => editor.isActive('strike'), h('s', {}, 'S')),
    colourButton(editor, 'Text colour', 'palette', TEXT_COLOURS, (c, v) => v ? c.setColor(v).run() : c.unsetColor().run()),
    colourButton(editor, 'Highlight', 'marker', [['None', null], ...HIGHLIGHTS], (c, v) => v ? c.setHighlight({ color: v }).run() : c.unsetHighlight().run()),
    sep(),
    btn('Bullet list', 'bullet', c => c.toggleBulletList().run(), () => editor.isActive('bulletList')),
    btn('Numbered list', 'numbered', c => c.toggleOrderedList().run(), () => editor.isActive('orderedList')),
    btn('Checklist', 'check', c => c.toggleTaskList().run(), () => editor.isActive('taskList')),
    btn('Quote', 'quote', c => c.toggleBlockquote().run(), () => editor.isActive('blockquote')),
    btn('Divider', 'rule', c => c.setHorizontalRule().run()),
    sep(),
    btn('Link', 'link', c => {
      const prev = editor.getAttributes('link').href || '';
      const url = prompt('Link address (leave empty to remove)', prev);
      if (url === null) return;
      if (!url.trim()) return c.extendMarkRange('link').unsetLink().run();
      const href = /^[a-z]+:/i.test(url.trim()) ? url.trim() : 'https://' + url.trim();
      if (!/^(https?|mailto|tel):/i.test(href)) return toast('Only web, email and phone links work');
      if (editor.state.selection.empty && !prev) return c.insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
      c.extendMarkRange('link').setLink({ href }).run();
    }, () => editor.isActive('link')),
    btn('Image from a web address', 'image', c => {
      const url = prompt('Web address of the image (https://…)');
      if (!url) return;
      if (!/^https:\/\//i.test(url.trim())) return toast('The address must start with https://');
      c.setImage({ src: url.trim() }).run();
    }),
    btn('Table', 'table', c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
    tableTools);

  tableTools.append(sep(),
    btn('Add row', null, c => c.addRowAfter().run(), null, '+Row'),
    btn('Add column', null, c => c.addColumnAfter().run(), null, '+Col'),
    btn('Delete row', null, c => c.deleteRow().run(), null, '−Row'),
    btn('Delete column', null, c => c.deleteColumn().run(), null, '−Col'),
    btn('Delete table', null, c => c.deleteTable().run(), null, '✕Table'));

  const refresh = () => {
    for (const { b, isOn } of items) if (isOn) b.setAttribute('aria-pressed', String(!!isOn()));
    const level = [1, 2, 3, 4, 5, 6].find(n => editor.isActive('heading', { level: n }));
    heading.value = String(level || 0);
    tableTools.hidden = !editor.isActive('table');
    tableTools.style.display = editor.isActive('table') ? 'contents' : 'none';
  };
  editor.on('transaction', refresh);
  refresh();
}

function colourButton(editor, label, iconName, colours, apply) {
  const b = h('button', { type: 'button', 'aria-label': label, title: label, 'aria-haspopup': 'true' }, icon(iconName));
  b.onmousedown = ev => ev.preventDefault();
  b.onclick = () => {
    document.querySelector('.popover')?.remove();
    const r = b.getBoundingClientRect();
    const pop = h('div', { class: 'popover', role: 'menu', style: `top:${r.bottom + window.scrollY + 6}px;left:${Math.max(8, Math.min(r.left, innerWidth - 270))}px` },
      colours.map(([name, value]) => h('button', { type: 'button', role: 'menuitem', class: 'swatch', 'aria-label': name, title: name,
        style: value ? `background:${value}` : 'background:linear-gradient(135deg,var(--surface) 45%,var(--danger) 45%,var(--danger) 55%,var(--surface) 55%)',
        onmousedown: ev => ev.preventDefault(),
        onclick: () => { apply(editor.chain().focus(), value); pop.remove(); } })));
    document.body.append(pop);
    const away = ev => { if (!pop.contains(ev.target) && ev.target !== b) { pop.remove(); document.removeEventListener('pointerdown', away); } };
    setTimeout(() => document.addEventListener('pointerdown', away), 0);
    pop.querySelector('button').focus();
  };
  return b;
}
