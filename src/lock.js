// PIN lock. The PIN is asked for every time the app opens, and again whenever it
// comes back to the front after being in the background (switching apps, the
// screen turning off). Choosing a photo or a ZIP file doesn't lock it.
//
// The PIN itself is never stored: only a salted PBKDF2-SHA-256 hash of it, in the
// app's storage on the phone. This keeps someone holding the phone out of the
// app; it doesn't encrypt the entries (that comes with Dropbox sync).

import { getMeta, setMeta, eraseEverything } from './store.js';
import { h, icon } from './ui.js';

const KEY = 'lock';
const ITERATIONS = 150000;
const MIN = 4, MAX = 8;
const PICKER_GRACE = 3 * 60 * 1000;   // how long a file picker may keep the app in the background

let cfg = null;   // { on, salt, hash, iterations, digits, failures, waitUntil }

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function hashPin(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
async function save(changes) { cfg = { ...(cfg || {}), ...changes }; await setMeta(KEY, cfg); }

export const lockOn = () => !!cfg?.on;

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await save({ on: true, salt: b64(salt), hash: await hashPin(pin, salt, ITERATIONS), iterations: ITERATIONS,
    digits: pin.length, failures: 0, waitUntil: 0 });
}
export const turnOff = () => save({ on: false, salt: null, hash: null, digits: null, failures: 0, waitUntil: 0 });

/** Checks a PIN, counting wrong tries: after 5 in a row, a wait that doubles each time (30 s up to 15 min). */
async function tryPin(pin) {
  if (await hashPin(pin, unb64(cfg.salt), cfg.iterations) === cfg.hash) {
    if (cfg.failures) await save({ failures: 0, waitUntil: 0 });
    return true;
  }
  const failures = (cfg.failures || 0) + 1;
  const wait = failures < 5 ? 0 : Math.min(30000 * 2 ** (failures - 5), 15 * 60000);
  await save({ failures, waitUntil: wait ? Date.now() + wait : 0 });
  return false;
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
  const el = h('div', { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'MMB Journal PIN' },
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
 */
function pinPad({ heading, note, error = null, digits = null, submit, waitUntil = () => 0, below = null }) {
  let pin = '', busy = false, timer = null;
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' });
  const msg = h('p', { class: 'pin-msg', role: 'status', 'aria-live': 'polite' });
  const counter = h('span', { class: 'visually-hidden', 'aria-live': 'polite' });
  const key = (k, label, cls) => h('button', { type: 'button', class: cls, 'aria-label': label, onclick: () => press(k) },
    k === 'back' ? icon('backspace') : k === 'ok' ? 'OK' : k);
  const okKey = digits ? h('span') : key('ok', 'OK', 'text');
  const keys = [...'123456789'].map(d => key(d, d));
  const pad = h('div', { class: 'keypad' }, keys, okKey, key('0', '0'), key('back', 'Delete last digit', 'text'));

  const draw = () => {
    const n = digits || Math.max(MIN, pin.length);
    dots.replaceChildren(...Array.from({ length: n }, (_, i) => h('span', { class: i < pin.length ? 'on' : '' })));
    counter.textContent = `${pin.length} ${pin.length === 1 ? 'digit' : 'digits'} entered`;
    if (okKey.tagName === 'BUTTON') okKey.disabled = pin.length < MIN;
  };
  const say = (text, error) => { msg.textContent = text || ''; msg.classList.toggle('error', !!error); };

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
    const problem = await submit(pin);
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
  const onKey = e => {
    if (!el.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (el.closest('.lock') !== [...document.querySelectorAll('body > .lock')].pop()) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter' && !digits) press('ok');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  const el = h('div', { class: 'pin' }, h('h1', {}, heading), h('p', { class: 'lock-note' }, note || ''),
    dots, counter, msg, pad, below);
  draw();
  if (!waiting() && error) say(error, true);
  return el;
}

// ---------- the screens ----------

let lockShown = null;

/** The lock screen. Resolves once the right PIN is entered. */
function unlockScreen() {
  if (lockShown) return lockShown;
  lockShown = new Promise(resolve => {
    const p = panel();
    const forgot = h('button', { type: 'button', class: 'lock-link', onclick: () => forgotScreen() }, 'Forgot your PIN?');
    p.body.append(pinPad({
      heading: 'Enter your PIN', digits: cfg.digits, waitUntil: () => cfg.waitUntil || 0,
      submit: async pin => {
        if (await tryPin(pin)) { p.close(); lockShown = null; resolve(); return null; }
        return 'That PIN isn\'t right. Try again.';
      },
      below: forgot
    }));
  });
  return lockShown;
}

function forgotScreen() {
  const p = panel({ onCancel: () => p.close() });
  const input = h('input', { type: 'text', class: 'input', id: 'erase-word', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const go = h('button', { type: 'button', class: 'btn danger', disabled: true, onclick: async () => {
    go.disabled = true; go.textContent = 'Erasing…';
    try { await eraseEverything(); location.replace(location.pathname + '#/'); location.reload(); }
    catch (e) { go.textContent = 'Erase failed: ' + e.message; }
  } }, 'Erase the journal on this phone');
  input.oninput = () => { go.disabled = input.value.trim().toUpperCase() !== 'ERASE'; };
  p.body.append(h('div', { class: 'pin forgot' },
    h('h1', {}, 'Forgot your PIN?'),
    h('p', { class: 'lock-note' }, 'Your PIN can\'t be looked up or reset, because it isn\'t stored anywhere.'),
    h('p', { class: 'lock-note' }, 'The only way back in is to erase the journal on this phone, choose a new PIN, then import your latest backup ZIP from More → Import. Anything written since that backup will be lost.'),
    h('div', { class: 'field' }, h('label', { for: 'erase-word' }, 'Type ERASE to confirm'), input),
    go));
}

/** Asks for a new PIN twice. Resolves with it, or null if cancelled. */
export function chooseNewPin({ heading = 'Choose a PIN', cancellable = true, skipLabel = null } = {}) {
  return new Promise(resolve => {
    let p;
    const finish = v => { p.close(); resolve(v); };
    const first = error => {
      p?.close();
      p = panel({ onCancel: cancellable ? () => finish(null) : null });
      const skip = skipLabel ? h('button', { type: 'button', class: 'lock-link', onclick: () => finish(null) }, skipLabel) : null;
      p.body.append(pinPad({ heading, note: `Use ${MIN} to ${MAX} digits. You'll need it every time you open the journal.`, error,
        submit: async pin => { second(pin); return null; }, below: skip }));
    };
    const second = pin => {
      p.close();
      p = panel({ onCancel: cancellable ? () => finish(null) : null });
      p.body.append(pinPad({ heading: 'Enter it again', note: 'To make sure it\'s the one you meant.', digits: pin.length,
        submit: async again => {
          if (again !== pin) { first('Those didn\'t match. Choose your PIN again.'); return null; }
          await setPin(pin); finish(pin); return null;
        } }));
    };
    first();
  });
}

/** Asks for the current PIN before changing or removing it. Resolves true or false. */
export function confirmCurrentPin(heading = 'Enter your current PIN') {
  return new Promise(resolve => {
    const p = panel({ onCancel: () => { p.close(); resolve(false); } });
    p.body.append(pinPad({ heading, digits: cfg.digits, waitUntil: () => cfg.waitUntil || 0,
      submit: async pin => {
        if (await tryPin(pin)) { p.close(); resolve(true); return null; }
        return 'That PIN isn\'t right. Try again.';
      } }));
  });
}

// ---------- start-up and locking ----------

/** Runs before the journal is shown: asks for the PIN, or to choose one the first time. */
export async function startLock() {
  cfg = (await getMeta(KEY).catch(() => null)) || null;
  if (cfg?.on) await unlockScreen();
  else if (!cfg) {
    const pin = await chooseNewPin({ heading: 'Choose a PIN for your journal', cancellable: false, skipLabel: 'Not now' });
    if (!pin) await save({ on: false });    // don't ask again; it can be turned on in More
  }

  let hiddenAt = 0, pickerAt = 0, skipped = false;
  // Choosing a photo or file sends the app to the background for a moment; that shouldn't lock it.
  document.addEventListener('click', e => {
    const t = e.target.closest?.('input[type=file], label[for]');
    if (t && (t.matches('input') || document.getElementById(t.htmlFor)?.type === 'file')) pickerAt = Date.now();
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (!lockOn()) return;
    const now = Date.now();
    if (document.hidden) {
      hiddenAt = now;
      if (now - pickerAt < 3000) skipped = true;
      else unlockScreen();                       // shown straight away, so nothing is visible on return
    } else if (skipped) {
      skipped = false;
      if (now - hiddenAt > PICKER_GRACE) unlockScreen();
    }
  });
}
