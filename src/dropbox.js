// Dropbox: signing in and the few file calls the journal needs. The app has
// "App folder" access, so it can only see Dropbox/Apps/MMB Journal/, and paths
// here start from that folder ("/journal.json").
//
// Sign-in uses OAuth PKCE with offline access: no App secret, and a long-lived
// refresh token so the app reconnects by itself. The sign-in is stored encrypted
// with the journal key.

import { getMeta, setMeta, deleteMeta, getSecret, setSecret, deleteSecret, unlocked } from './store.js';
import { DROPBOX_APP_KEY, dropboxHosts } from './config.js';
import { randomBytes, b64 } from './crypto.js';

const hosts = dropboxHosts();
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const redirectUri = () => location.origin + location.pathname;
let auth = null;

export class DropboxError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }   // kind: 'signin', 'network', 'space', 'other'
}

/** Goes to Dropbox to sign in. `purpose` ('connect' or 'restore') comes back from finishSignIn. */
export async function startSignIn(purpose = 'connect') {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(randomBytes(12));
  await setMeta('pkce', { verifier, state, purpose, t: Date.now() });
  const params = new URLSearchParams({
    client_id: DROPBOX_APP_KEY, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    token_access_type: 'offline', redirect_uri: redirectUri(), state
  });
  location.href = `${hosts.www}/oauth2/authorize?${params}`;
  return new Promise(() => {});   // the page is leaving
}

async function tokenRequest(fields) {
  let res;
  try {
    res = await fetch(`${hosts.api}/oauth2/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DROPBOX_APP_KEY, ...fields })
    });
  } catch { throw new DropboxError('Couldn\'t reach Dropbox. Check you\'re online.', 'network'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw new DropboxError('Dropbox needs you to sign in again.', 'signin');
    throw new DropboxError(`Dropbox sign-in failed (${json.error_description || json.error || res.status}).`, 'other');
  }
  return json;
}

/** If Dropbox has just sent the app back after sign-in, finishes it. Returns { purpose, auth }, or null. */
export async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  const pkce = await getMeta('pkce');
  await deleteMeta('pkce');
  if (q.has('error')) {
    throw new DropboxError(q.get('error') === 'access_denied' ? 'Dropbox wasn\'t connected: you chose not to allow it.'
      : `Dropbox sign-in stopped (${q.get('error_description') || q.get('error')}).`, 'signin');
  }
  if (!pkce || pkce.state !== q.get('state')) throw new DropboxError('That Dropbox sign-in didn\'t start from this app. Please try again.', 'signin');
  const t = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), code_verifier: pkce.verifier, redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new DropboxError('Dropbox didn\'t give the app lasting access. Please try again.', 'signin');
  return { purpose: pkce.purpose, auth: { access: t.access_token, expiry: Date.now() + (t.expires_in || 14400) * 1000, refresh: t.refresh_token, since: Date.now() } };
}

/** Uses a sign-in without saving it (restoring on a new phone, before the journal key exists). */
export const useAuth = a => { auth = a; };
export async function saveAuth(a = auth) { auth = a; if (a) await setSecret('dropbox', a); }
export async function loadAuth() { auth = await getSecret('dropbox'); return !!auth; }
export const connected = () => !!auth;
export const connectedSince = () => auth?.since || null;

export async function disconnect() {
  const a = auth;
  auth = null;
  await deleteSecret('dropbox');
  if (a) { try { await fetch(`${hosts.api}/2/auth/token/revoke`, { method: 'POST', headers: { Authorization: 'Bearer ' + a.access } }); } catch { /* fine */ } }
}

async function token(force = false) {
  if (!auth) throw new DropboxError('Dropbox isn\'t connected.', 'signin');
  if (!force && auth.expiry - 60000 > Date.now()) return auth.access;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh });
  auth = { ...auth, access: t.access_token, expiry: Date.now() + (t.expires_in || 14400) * 1000 };
  if (unlocked()) await setSecret('dropbox', auth);
  return auth.access;
}

// Dropbox-API-Arg must be plain ASCII.
const argHeader = arg => JSON.stringify(arg).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(host, endpoint, { arg, json, body } = {}, tries = 0) {
  const headers = { Authorization: 'Bearer ' + await token() };
  if (arg) headers['Dropbox-API-Arg'] = argHeader(arg);
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  else if (body !== undefined) headers['Content-Type'] = 'application/octet-stream';
  let res;
  try { res = await fetch(`${hosts[host]}/2/${endpoint}`, { method: 'POST', headers, body: json !== undefined ? JSON.stringify(json) : body }); }
  catch { throw new DropboxError('Couldn\'t reach Dropbox. Check you\'re online.', 'network'); }
  if (res.ok) return res;
  if (res.status === 401 && tries === 0) { await token(true); return call(host, endpoint, { arg, json, body }, 1); }
  if ((res.status === 429 || res.status >= 500) && tries < 4) {
    const wait = Number(res.headers.get('Retry-After')) || 2 ** tries;
    await sleep(Math.min(wait, 30) * 1000);
    return call(host, endpoint, { arg, json, body }, tries + 1);
  }
  const text = await res.text().catch(() => '');
  let summary = '';
  try { summary = JSON.parse(text).error_summary || ''; } catch { summary = text.slice(0, 120); }
  if (res.status === 409) {
    const err = new DropboxError(`Dropbox: ${summary}`, /insufficient_space/.test(summary) ? 'space' : 'other');
    err.summary = summary;
    if (/insufficient_space/.test(summary)) err.message = 'Your Dropbox is full, so the journal can\'t be saved there.';
    throw err;
  }
  if (res.status === 401) throw new DropboxError('Dropbox needs you to sign in again.', 'signin');
  throw new DropboxError(`Dropbox error ${res.status}${summary ? ': ' + summary : ''}`, 'other');
}

/** Uploads bytes, replacing any file already there. Returns Dropbox's file details (with rev). */
export async function upload(path, bytes) {
  if (bytes.length > 150e6) throw new DropboxError(`${path.split('/').pop()} is over 150 MB, which is too big to save to Dropbox in one go.`, 'other');
  const res = await call('content', 'files/upload', { arg: { path, mode: 'overwrite', mute: true }, body: bytes });
  return res.json();
}

/** Downloads a file. Returns null if it isn't there. */
export async function download(path) {
  try { return new Uint8Array(await (await call('content', 'files/download', { arg: { path } })).arrayBuffer()); }
  catch (e) { if (/not_found/.test(e.summary || '')) return null; throw e; }
}
export async function downloadJson(path) {
  const bytes = await download(path);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return { unreadable: true }; }
}

/** Deletes a file or folder. Fine if it's already gone. */
export async function remove(path) {
  try { await call('api', 'files/delete_v2', { json: { path } }); }
  catch (e) { if (!/not_found/.test(e.summary || '')) throw e; }
}

/** Every file in the app folder, or what changed since `cursor`. Returns { entries, cursor } or { reset: true }. */
export async function list(cursor) {
  const entries = [];
  let res;
  try {
    res = cursor ? await (await call('api', 'files/list_folder/continue', { json: { cursor } })).json()
      : await (await call('api', 'files/list_folder', { json: { path: '', recursive: true, include_deleted: false } })).json();
  } catch (e) { if (cursor && /reset/.test(e.summary || '')) return { reset: true }; throw e; }
  entries.push(...res.entries);
  while (res.has_more) {
    res = await (await call('api', 'files/list_folder/continue', { json: { cursor: res.cursor } })).json();
    entries.push(...res.entries);
  }
  return { entries, cursor: res.cursor };
}
