// A stand-in for Dropbox, for testing sync on this computer without a real account.
//   node tools/mock-dropbox.mjs [port]        (default 8739)
// Then, in the app served from localhost, run in the browser console:
//   localStorage.setItem('mmb-mock-dropbox', 'http://localhost:8739')
// It keeps files in memory and supports the calls the app uses: sign-in (PKCE),
// token refresh, upload, download, list_folder (+continue), delete_v2, revoke.
// Extra test helpers: GET /_files lists what's stored; POST /_reset empties it;
// POST /_expire makes the access token expire.
import { createServer } from 'node:http';

const port = Number(process.argv[2]) || 8739;
let files = new Map();     // lower path → { path, bytes, rev }
let log = [];              // changes: { path (display), lower, deleted }
let revN = 1;
let tokenN = 1, validToken = null;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Dropbox-API-Arg',
  'Access-Control-Expose-Headers': 'Dropbox-API-Result',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};
const send = (res, status, body, headers = {}) => {
  const isBuf = body instanceof Uint8Array;
  res.writeHead(status, { ...cors, 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
};
const meta = f => ({ '.tag': 'file', name: f.path.split('/').pop(), path_lower: f.path.toLowerCase(), path_display: f.path, rev: f.rev, size: f.bytes.length, id: 'id:' + f.path.toLowerCase() });
const readBody = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const conflict = (res, summary) => send(res, 409, { error_summary: summary, error: {} });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const body = await readBody(req);

  if (url.pathname === '/oauth2/authorize') {
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'mock-code-' + Date.now());
    back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { Location: back.toString() }); return res.end();
  }
  if (url.pathname === '/oauth2/token') {
    const f = new URLSearchParams(body.toString());
    if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') !== 'mock-refresh') return send(res, 400, { error: 'invalid_grant' });
    validToken = 'mock-access-' + tokenN++;
    return send(res, 200, { access_token: validToken, expires_in: 14400, token_type: 'bearer',
      ...(f.get('grant_type') === 'authorization_code' ? { refresh_token: 'mock-refresh', account_id: 'dbid:mock' } : {}) });
  }
  if (url.pathname === '/_files') return send(res, 200, [...files.values()].map(f => ({ path: f.path, bytes: f.bytes.length, rev: f.rev, start: f.bytes.subarray(0, 5).toString() })));
  if (url.pathname === '/_reset') { files = new Map(); log = []; return send(res, 200, { ok: true }); }
  if (url.pathname === '/_expire') { validToken = 'expired'; return send(res, 200, { ok: true }); }

  if ((req.headers.authorization || '') !== 'Bearer ' + validToken) return send(res, 401, { error_summary: 'expired_access_token/', error: { '.tag': 'expired_access_token' } });
  const arg = req.headers['dropbox-api-arg'] ? JSON.parse(req.headers['dropbox-api-arg']) : JSON.parse(body.toString() || '{}');

  switch (url.pathname) {
    case '/2/files/upload': {
      const f = { path: arg.path, bytes: new Uint8Array(body), rev: (revN++).toString(16).padStart(9, '0') };
      files.set(arg.path.toLowerCase(), f); log.push({ lower: arg.path.toLowerCase(), path: arg.path });
      return send(res, 200, meta(f));
    }
    case '/2/files/download': {
      const f = files.get(arg.path.toLowerCase());
      if (!f) return conflict(res, 'path/not_found/..');
      return send(res, 200, f.bytes, { 'Dropbox-API-Result': JSON.stringify(meta(f)) });
    }
    case '/2/files/delete_v2': {
      const p = arg.path.toLowerCase();
      const hit = [...files.keys()].filter(k => k === p || k.startsWith(p + '/'));
      if (!hit.length) return conflict(res, 'path_lookup/not_found/..');
      hit.forEach(k => files.delete(k));
      log.push({ lower: p, path: arg.path, deleted: true });     // like Dropbox: one entry for a deleted folder
      return send(res, 200, { metadata: { '.tag': 'folder', path_lower: p, path_display: arg.path } });
    }
    case '/2/files/list_folder':
      return send(res, 200, { entries: [...files.values()].map(meta), cursor: String(log.length), has_more: false });
    case '/2/files/list_folder/continue': {
      const from = Number(arg.cursor);
      if (!Number.isInteger(from) || from > log.length) return conflict(res, 'reset/..');
      const seen = new Map();
      for (const c of log.slice(from)) seen.set(c.lower, c);
      const entries = [...seen.values()].map(c => {
        const f = files.get(c.lower);
        return c.deleted || !f ? { '.tag': 'deleted', name: c.path.split('/').pop(), path_lower: c.lower, path_display: c.path } : meta(f);
      });
      return send(res, 200, { entries, cursor: String(log.length), has_more: false });
    }
    case '/2/auth/token/revoke': validToken = null; return send(res, 200, null);
    default: return send(res, 404, { error_summary: 'unknown endpoint' });
  }
}).listen(port, () => console.log(`Mock Dropbox on http://localhost:${port}`));
