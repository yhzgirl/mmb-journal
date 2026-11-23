// Dropbox app details. The App key is public by design (it's sent to Dropbox in
// the address bar when signing in). The App secret is never used or stored here:
// sign-in uses PKCE instead.
export const DROPBOX_APP_KEY = '5ivscig9drq19wp';

// For testing on this computer only: when the app is served from localhost and
// localStorage "mmb-mock-dropbox" holds an address (tools/mock-dropbox.mjs), all
// Dropbox calls go there instead. It can't be switched on for the real site.
export function dropboxHosts() {
  let mock = null;
  try { if (['localhost', '127.0.0.1'].includes(location.hostname)) mock = localStorage.getItem('mmb-mock-dropbox'); } catch { /* ignore */ }
  return mock ? { www: mock, api: mock, content: mock }
    : { www: 'https://www.dropbox.com', api: 'https://api.dropboxapi.com', content: 'https://content.dropboxapi.com' };
}
