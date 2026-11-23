// The lock, and the keys that open the journal.
//
// Everything in the journal is encrypted with one random journal key (crypto.js).
// That key is kept on the phone only in wrapped (encrypted) form:
//   - by the PIN, asked for every time the app opens or comes back to the front
//   - by the fingerprint, if turned on (passkey PRF)
//   - by the recovery key, which is also the copy kept in Dropbox's journal.json
// The PIN and fingerprint copies never leave the phone: a 4-digit PIN could be
// guessed quickly by anyone who got hold of a copy, so Dropbox only ever gets the
// one locked by the 120-bit recovery key.
//
// Choosing a photo or file sends the app to the background for a moment; that
// doesn't lock it.

import * as store from './store.js';
import * as cr from './crypto.js';
import { h, icon } from './ui.js';

const KEY = 'lock';
const ITERATIONS = 300000;
const MIN = 4, MAX = 8;
const PICKER_GRACE = 3 * 60 * 1000;
const PRF_INPUT = new TextEncoder().encode('mmb-journal fingerprint prf v1');

let cfg = null;
let journal = null;      // { raw, key } while unlocked

async function save(changes) { cfg = { ...(cfg || {}), ...changes }; await store.setMeta(KEY, cfg); }

export const lockOn = () => cfg?.v === 2;
export const fingerprintOn = () => !!cfg?.fingerprint;
/** The journal key and recovery block, for writing journal.json to Dropbox. */
export const journalKey = () => journal && { ...journal, keyId: cfg.keyId, recovery: cfg.recovery, recoveryPending: !!cfg.recoveryPending };

// ---------- PIN ----------

async function pinKek(pin, salt = cr.unb64(cfg.pin.salt), iterations = cfg.pin.iterations) {
  return cr.kekFromPin(pin, salt, iterations);
}

/** Checks a PIN by opening the journal key with it. After 5 wrong tries in a row, a wait that doubles (30 s up to 15 min). */
async function tryPin(pin) {
  try {
    const kek = await pinKek(pin);
    const raw = await cr.unwrap(kek, cfg.pin);
    const old = cfg.oldPin ? await cr.unwrap(kek, cfg.oldPin) : null;
    if (cfg.failures) await save({ failures: 0, waitUntil: 0 });
    return { raw, old, kek };
  } catch {
    const failures = (cfg.failures || 0) + 1;
    const wait = failures < 5 ? 0 : Math.min(30000 * 2 ** (failures - 5), 15 * 60000);
    await save({ failures, waitUntil: wait ? Date.now() + wait : 0 });
    return null;
  }
}

/** Version 1 of the lock (PIN only, no encryption) kept a hash of the PIN. */
async function tryOldPin(pin) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: cr.unb64(cfg.salt), iterations: cfg.iterations }, base, 256);
  if (cr.b64(bits) === cfg.hash) return true;
  const failures = (cfg.failures || 0) + 1;
  const wait = failures < 5 ? 0 : Math.min(30000 * 2 ** (failures - 5), 15 * 60000);
  await save({ failures, waitUntil: wait ? Date.now() + wait : 0 });
  return false;
}

async function wrapForPin(pin, raw, old = null) {
  const salt = cr.randomBytes(16);
  const kek = await pinKek(pin, salt, ITERATIONS);
  return {
    digits: pin.length, failures: 0, waitUntil: 0,
    pin: { kdf: 'PBKDF2-SHA-256', salt: cr.b64(salt), iterations: ITERATIONS, ...(await cr.wrap(kek, raw)) },
    oldPin: old ? await cr.wrap(kek, old) : null
  };
}

async function useKeys(raw, old = null) {
  journal = { raw, key: await cr.importJournalKey(raw) };
  store.setKeys(journal.key, old ? await cr.importJournalKey(old) : null);
}

// ---------- fingerprint ----------

export async function fingerprintAvailable() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}

async function prfSecret(credId) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: cr.randomBytes(32),
    allowCredentials: [{ type: 'public-key', id: cr.unb64(credId), transports: ['internal', 'hybrid'] }],
    userVerification: 'required',
    extensions: { prf: { eval: { first: PRF_INPUT } } }
  } });
  const out = a.getClientExtensionResults().prf?.results?.first;
  if (!out || out.byteLength < 32) throw new Error('This phone checked your fingerprint but can\'t use it to unlock encryption.');
  return new Uint8Array(out);
}

/** Sets up fingerprint unlock. The phone asks for the fingerprint once or twice. */
export async function setUpFingerprint() {
  if (!journal) throw new Error('The journal is locked');
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: cr.randomBytes(32),
    rp: { name: 'MMB Journal' },
    user: { id: cr.randomBytes(16), name: 'MMB Journal', displayName: 'MMB Journal' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    extensions: { prf: { eval: { first: PRF_INPUT } } }
  } });
  const credId = cr.b64(cred.rawId);
  let out = cred.getClientExtensionResults().prf?.results?.first;
  out = out && out.byteLength >= 32 ? new Uint8Array(out) : await prfSecret(credId);
  const salt = cr.randomBytes(16);
  const kek = await cr.kekFromSecret(out, salt, cr.FINGERPRINT_INFO);
  await save({ fingerprint: { credId, salt: cr.b64(salt), ...(await cr.wrap(kek, journal.raw)) } });
}
export const turnOffFingerprint = () => save({ fingerprint: null });

async function tryFingerprint() {
  const f = cfg.fingerprint;
  const kek = await cr.kekFromSecret(await prfSecret(f.credId), cr.unb64(f.salt), cr.FINGERPRINT_INFO);
  return { raw: await cr.unwrap(kek, f) };
}

// ---------- full-screen panels ----------

/** Only the top panel can be used; everything under it is inert. */
function refreshInert() {
  const panels = [...document.querySelectorAll('body > .lock')];
  const top = panels[panels.length - 1];
  for (const el of document.body.children) el.inert = !!top && el !== top;
}

function panel({ onCancel } = {}) {
  document.activeElement?.blur?.();
  const body = h('div', { class: 'lock-body' });
  const el = h('div', { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'MMB Journal' },
    onCancel ? h('button', { class: 'icon-btn lock-close', type: 'button', 'aria-label': 'Cancel', onclick: onCancel }, icon('close')) : null,
    h('img', { class: 'lock-brand', src: 'icons/icon-192.png', alt: '' }),
    body);
  document.body.append(el);
  refreshInert();
  return { el, body, close() { el.remove(); refreshInert(); } };
}

/**
 * A number pad. With `digits` set it checks as soon as that many are typed;
 * otherwise (choosing a PIN) it takes 4 to 8 digits and an OK key.
 * `submit(pin)` returns null when done, or a message to show and start again.
 * `extra` fills the bottom-left key (the fingerprint button).
 */
function pinPad({ heading, note, error = null, digits = null, submit, waitUntil = () => 0, below = null, extra = null }) {
  let pin = '', busy = false, timer = null;
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' });
  const msg = h('p', { class: 'pin-msg', role: 'status', 'aria-live': 'polite' });
  const counter = h('span', { class: 'visually-hidden', 'aria-live': 'polite' });
  const key = (k, label, cls) => h('button', { type: 'button', class: cls, 'aria-label': label, onclick: () => press(k) },
    k === 'back' ? icon('backspace') : k === 'ok' ? 'OK' : k);
  const okKey = digits ? (extra || h('span')) : key('ok', 'OK', 'text');
  const keys = [...'123456789'].map(d => key(d, d));
  const pad = h('div', { class: 'keypad' }, keys, okKey, key('0', '0'), key('back', 'Delete last digit', 'text'));

  const draw = () => {
    const n = digits || Math.max(MIN, pin.length);
    dots.replaceChildren(...Array.from({ length: n }, (_, i) => h('span', { class: i < pin.length ? 'on' : '' })));
    counter.textContent = `${pin.length} ${pin.length === 1 ? 'digit' : 'digits'} entered`;
    if (!digits) okKey.disabled = pin.length < MIN;
  };
  const say = (text, isError) => { msg.textContent = text || ''; msg.classList.toggle('error', !!isError); };

  // After too many wrong tries: keys off and a countdown.
  const waiting = () => {
    const left = waitUntil() - Date.now();
    clearTimeout(timer);
    if (left <= 0) { pad.classList.remove('off'); return false; }
    pad.classList.add('off');
    const s = Math.ceil(left / 1000);
    say(`Too many wrong tries. Try again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.`, true);
    timer = setTimeout(() => { if (!waiting()) say(''); }, 1000);
    return true;
  };

  async function go() {
    busy = true; pad.classList.add('busy');
    say(digits ? 'Checking…' : '');
    let problem;
    try { problem = await submit(pin); } catch (e) { problem = e.message; }
    busy = false; pad.classList.remove('busy');
    if (problem === null) return;
    pin = ''; draw();
    if (!waiting()) say(problem, true);
    dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
  }
  function press(k) {
    if (busy || waiting()) return;
    if (k === 'ok') { if (pin.length >= MIN) go(); return; }
    if (k === 'back') pin = pin.slice(0, -1);
    else if (pin.length < (digits || MAX)) pin += k;
    say('');
    draw();
    if (digits && pin.length === digits) go();
  }
  const el = h('div', { class: 'pin' }, h('h1', {}, heading), h('p', { class: 'lock-note' }, note || ''),
    dots, counter, msg, pad, below);
  const onKey = e => {
    if (!el.isConnected) { if (el.dataset.shown) document.removeEventListener('keydown', onKey); return; }
    el.dataset.shown = '1';
    if (el.closest('.lock') !== [...document.querySelectorAll('body > .lock')].pop()) return;
    if (e.target.matches?.('input, textarea')) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter' && !digits) press('ok');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  draw();
  if (!waiting() && error) say(error, true);
  return Object.assign(el, { say });
}

/** A screen that shows progress while the journal is being encrypted. */
function progressPanel(heading, note) {
  const p = panel();
  const bar = h('progress', { max: 1, value: 0 });
  const count = h('p', { class: 'lock-note' }, '');
  p.body.append(h('div', { class: 'pin' }, h('h1', {}, heading), h('p', { class: 'lock-note' }, note), bar, count));
  return { ...p, update(done, total) { bar.max = total || 1; bar.value = done; count.textContent = total ? `${done} of ${total}` : ''; } };
}

// ---------- the screens ----------

let lockShown = null;

/** The lock screen. Resolves with the opened keys once the right PIN or fingerprint is given. */
function unlockScreen() {
  if (lockShown) return lockShown;
  lockShown = new Promise(resolve => {
    const p = panel();
    const done = keys => { p.close(); lockShown = null; resolve(keys); };
    const v1 = cfg.v !== 2;
    let pad;
    const finger = !v1 && cfg.fingerprint && !cfg.oldPin
      ? h('button', { type: 'button', class: 'text', 'aria-label': 'Unlock with fingerprint', onclick: () => useFinger() }, icon('fingerprint'))
      : null;
    async function useFinger() {
      try { done(await tryFingerprint()); }
      catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') pad.say(e.message, true); }
    }
    pad = pinPad({
      heading: 'Enter your PIN', digits: cfg.digits, waitUntil: () => cfg.waitUntil || 0, extra: finger,
      submit: async pin => {
        if (v1) { if (await tryOldPin(pin)) { done({ pin }); return null; } }
        else { const keys = await tryPin(pin); if (keys) { done(keys); return null; } }
        return 'That PIN isn\'t right. Try again.';
      },
      below: v1 ? h('button', { type: 'button', class: 'lock-link', onclick: () => eraseScreen() }, 'Forgot your PIN?')
        : h('button', { type: 'button', class: 'lock-link', onclick: () => forgotScreen(done) }, 'Forgot your PIN?')
    });
    p.body.append(pad);
    if (finger) {
      // Ask for the fingerprint straight away, or as soon as the app is back on screen.
      if (document.visibilityState === 'visible') setTimeout(useFinger, 300);
      else document.addEventListener('visibilitychange', function back() {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', back);
        if (p.el.isConnected) setTimeout(useFinger, 300);
      });
    }
  });
  return lockShown;
}

/** Forgot PIN: open the journal with the recovery key, then choose a new PIN. */
function forgotScreen(done) {
  const p = panel({ onCancel: () => p.close() });
  p.body.append(recoveryForm({
    heading: 'Forgot your PIN?',
    note: 'Type your recovery key to open your journal, then choose a new PIN.',
    open: async text => {
      const raw = await cr.openRecoveryBlock(cfg.recovery, text);
      const pin = await chooseNewPin({ heading: 'Choose a new PIN', cancellable: false });
      await save(await wrapForPin(pin, raw));
      p.close();
      done({ raw });
    },
    below: h('button', { type: 'button', class: 'lock-link', onclick: () => eraseScreen() }, 'Lost your recovery key too?')
  }));
}

function recoveryForm({ heading, note, open, below = null, button = 'Open my journal' }) {
  const input = h('input', { type: 'text', class: 'input recovery-input', id: 'recovery-key', autocomplete: 'off',
    autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' });
  const msg = h('p', { class: 'pin-msg', role: 'status', 'aria-live': 'polite' });
  const go = h('button', { type: 'button', class: 'btn', disabled: true }, button);
  input.oninput = () => { go.disabled = !cr.parseRecoveryKey(input.value); msg.textContent = ''; };
  input.onkeydown = e => { if (e.key === 'Enter' && !go.disabled) go.click(); };
  go.onclick = async () => {
    go.disabled = true; msg.classList.remove('error'); msg.textContent = 'Checking…';
    try { await open(input.value); }
    catch (e) { msg.textContent = e.message; msg.classList.add('error'); go.disabled = false; }
  };
  setTimeout(() => input.focus(), 50);
  return h('div', { class: 'pin forgot' }, h('h1', {}, heading), h('p', { class: 'lock-note' }, note),
    h('div', { class: 'field' }, h('label', { for: 'recovery-key' }, 'Recovery key'), input), msg, go, below);
}

function eraseScreen() {
  const p = panel({ onCancel: () => p.close() });
  const input = h('input', { type: 'text', class: 'input', id: 'erase-word', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const go = h('button', { type: 'button', class: 'btn danger', disabled: true, onclick: async () => {
    go.disabled = true; go.textContent = 'Erasing…';
    try { await store.eraseEverything(); location.replace(location.pathname + '#/'); location.reload(); }
    catch (e) { go.textContent = 'Erase failed: ' + e.message; }
  } }, 'Erase the journal on this phone');
  input.oninput = () => { go.disabled = input.value.trim().toUpperCase() !== 'ERASE'; };
  p.body.append(h('div', { class: 'pin forgot' },
    h('h1', {}, 'Start again on this phone'),
    h('p', { class: 'lock-note' }, 'Without your PIN or recovery key, the journal on this phone can\'t be opened by anyone, including you.'),
    h('p', { class: 'lock-note' }, 'You can erase it and start again. If you still have a backup ZIP, you can import it afterwards from More → Import.'),
    h('div', { class: 'field' }, h('label', { for: 'erase-word' }, 'Type ERASE to confirm'), input),
    go));
}

/** Asks for a new PIN twice. Resolves with it, or null if cancelled. */
export function chooseNewPin({ heading = 'Choose a PIN', note = null, cancellable = true } = {}) {
  return new Promise(resolve => {
    let p;
    const finish = v => { p.close(); resolve(v); };
    const first = error => {
      p?.close();
      p = panel({ onCancel: cancellable ? () => finish(null) : null });
      p.body.append(pinPad({ heading, note: note || `Use ${MIN} to ${MAX} digits. You'll need it every time you open the journal.`, error,
        submit: async pin => { second(pin); return null; } }));
    };
    const second = pin => {
      p.close();
      p = panel({ onCancel: cancellable ? () => finish(null) : null });
      p.body.append(pinPad({ heading: 'Enter it again', note: 'To make sure it\'s the one you meant.', digits: pin.length,
        submit: async again => { if (again !== pin) first('Those didn\'t match. Choose your PIN again.'); else finish(pin); return null; } }));
    };
    first();
  });
}

/** Asks for the current PIN. Resolves with the opened keys, or null if cancelled. */
export function confirmCurrentPin(heading = 'Enter your current PIN') {
  return new Promise(resolve => {
    const p = panel({ onCancel: () => { p.close(); resolve(null); } });
    p.body.append(pinPad({ heading, digits: cfg.digits, waitUntil: () => cfg.waitUntil || 0,
      submit: async pin => {
        const keys = await tryPin(pin);
        if (keys) { p.close(); resolve({ ...keys, pin }); return null; }
        return 'That PIN isn\'t right. Try again.';
      } }));
  });
}

export async function changePin() {
  const keys = await confirmCurrentPin();
  if (!keys) return false;
  const pin = await chooseNewPin({ heading: 'Choose a new PIN' });
  if (!pin) return false;
  await save(await wrapForPin(pin, keys.raw, keys.old));
  return true;
}

/** Shows a new recovery key until it's been saved, then stores its lock on the journal key. */
export function newRecoveryKey({ first = false } = {}) {
  return new Promise(resolve => {
    const text = cr.newRecoveryKey();
    const p = panel(first ? {} : { onCancel: () => { p.close(); resolve(false); } });
    const last = text.slice(-4);
    const check = h('input', { type: 'text', class: 'input', id: 'recovery-check', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 4 });
    const msg = h('p', { class: 'pin-msg', role: 'status', 'aria-live': 'polite' });
    const done = h('button', { type: 'button', class: 'btn', disabled: true, onclick: async () => {
      done.disabled = true;
      await save({ recovery: await cr.recoveryBlock(journal.raw, text), recoveryConfirmed: true, recoveryPending: true });
      p.close(); resolve(true);
    } }, 'I\'ve saved it');
    check.oninput = () => {
      const ok = check.value.trim().toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1') === last;
      done.disabled = !ok;
      msg.textContent = check.value.length === 4 && !ok ? 'That doesn\'t match the end of the key.' : '';
    };
    const copy = h('button', { type: 'button', class: 'btn secondary', onclick: async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Couldn\'t copy: write it down instead'; }
    } }, 'Copy');
    p.body.append(h('div', { class: 'pin forgot' },
      h('h1', {}, first ? 'Your recovery key' : 'Your new recovery key'),
      h('p', { class: 'recovery-key', 'aria-label': 'Recovery key: ' + [...text].join(' ') },
        text.split('-').map((g, i, all) => h('span', {}, g + (i < all.length - 1 ? '-' : '')))),
      copy,
      h('p', { class: 'lock-note' }, 'If you forget your PIN, or move to a new phone, this key is the only way to open your journal, including the copy in Dropbox. Nobody else has it, not even Dropbox.'),
      h('p', { class: 'lock-note' }, first ? 'Keep it somewhere safe that isn\'t this phone: your password manager, or written down and kept at home.'
        : 'Keep it somewhere safe that isn\'t this phone. Your old recovery key stops working once you tap "I\'ve saved it".'),
      h('div', { class: 'field' }, h('label', { for: 'recovery-check' }, 'To check, type the last 4 characters'), check),
      msg, done));
  });
}

/** A new recovery key was made on another phone (same journal key): use its lock here too. */
export const setRecovery = block => save({ recovery: block, recoveryConfirmed: true, recoveryPending: false });
export const recoverySent = () => save({ recoveryPending: false });

/** Takes on another journal key (the one already used in Dropbox), re-encrypting what's on this phone. */
export async function adoptJournalKey(raw, recovery, newKeyId) {
  const keys = await confirmCurrentPin('Enter your PIN to finish connecting');
  if (!keys) return false;
  const kek = await pinKek(keys.pin);
  await save({ pin: { ...cfg.pin, ...(await cr.wrap(kek, raw)) }, oldPin: await cr.wrap(kek, journal.raw),
    recovery, recoveryConfirmed: true, recoveryPending: false, keyId: newKeyId, fingerprint: null });
  await useKeys(raw, keys.raw);
  await sealWithProgress('Switching keys', 'Re-encrypting your journal with the key from Dropbox.');
  return true;
}

async function sealWithProgress(heading, note) {
  const pr = progressPanel(heading, note);
  try {
    await store.sealEverything((d, t) => pr.update(d, t));
    if (cfg.oldPin) { await save({ oldPin: null }); store.setKeys(journal.key); }
  } finally { pr.close(); }
}

/** First-time set-up of encryption: a new journal key, locked by the PIN, plus a recovery key. */
async function createJournalKey(pin, { raw = null, recovery = null } = {}) {
  const k = raw ? { raw } : await cr.newJournalKey();
  cfg = { v: 2, keyId: await cr.keyId(k.raw), fingerprint: null, recovery, recoveryConfirmed: !!recovery, ...(await wrapForPin(pin, k.raw)) };
  await store.setMeta(KEY, cfg);
  await useKeys(k.raw);
}

// ---------- start-up and locking ----------

/**
 * Runs before the journal is shown. Asks for the PIN (or to choose one), opens
 * the journal key, and finishes any encryption still to do.
 * `restore(pin)` is called when the person chooses to restore from Dropbox on a
 * new phone; it returns the journal key and recovery block from Dropbox.
 */
export async function startLock({ welcome } = {}) {
  cfg = (await store.getMeta(KEY).catch(() => null)) || null;

  if (cfg?.v === 2) {
    const keys = await unlockScreen();
    await useKeys(keys.raw, keys.old);
  } else if (cfg?.on && cfg.hash) {
    // The PIN from before encryption: check it the old way, then encrypt with it.
    const { pin } = await unlockScreen();
    await createJournalKey(pin);
  } else {
    // No PIN yet: a new phone, or the PIN lock was turned off before.
    const choice = welcome && !(await store.countEntries()) ? await welcome() : null;
    if (choice?.restored) await createJournalKey(choice.pin, choice);
    else {
      const pin = await chooseNewPin({ heading: 'Choose a PIN for your journal', cancellable: false,
        note: `Use ${MIN} to ${MAX} digits. It unlocks your journal, which is now encrypted on this phone and in Dropbox.` });
      await createJournalKey(pin);
    }
  }

  if (cfg.oldPin || await store.hasUnsealed()) {
    await sealWithProgress('Encrypting your journal', 'This happens once. Keep the app open until it finishes.');
  }
  if (!cfg.recoveryConfirmed) await newRecoveryKey({ first: true });
  watchForLeaving();
}

/** Screens for the welcome choice on a new phone, used by main.js. */
export const ui = { panel, recoveryForm, chooseNewPin };

function watchForLeaving() {
  let hiddenAt = 0, pickerAt = 0, skipped = false;
  document.addEventListener('click', e => {
    const t = e.target.closest?.('input[type=file], label[for]');
    if (t && (t.matches('input') || document.getElementById(t.htmlFor)?.type === 'file')) pickerAt = Date.now();
  }, true);
  const relock = async () => { const keys = await unlockScreen(); if (keys.raw && !journal) await useKeys(keys.raw); };
  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.hidden) {
      hiddenAt = now;
      if (now - pickerAt < 3000) skipped = true;
      else relock();                       // shown straight away, so nothing is visible on return
    } else if (skipped) {
      skipped = false;
      if (now - hiddenAt > PICKER_GRACE) relock();
    }
  });
}
