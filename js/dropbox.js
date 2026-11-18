// Dropbox: sign in through Dropbox's own page (PKCE: no password or secret
// ever touches this app), list the shoot folders, download photos, and save
// finished photos into a "callouts" folder inside each address folder.
// The sign-in is remembered in this browser only.
(function (DT) {
  const APP_KEY = 'rlly896zu6w4cx4';
  const STORE = 'dronetag:dropbox';          // { refresh, access, expires, name, root }
  const VERIFIER = 'dronetag:dropbox-pkce';  // kept only during sign-in
  // Must match a Redirect URI set in the Dropbox app settings exactly.
  const redirectUri = () => location.origin + '/';

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch (e) { return null; } };
  const save = (v) => { try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch (e) { /* private window */ } };
  let auth = load();

  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function pkce() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    return { verifier, challenge: b64url(digest) };
  }

  // Sign-in happens in a small pop-up window so nothing open in Pinpoint is
  // lost. Dropbox sends the pop-up back to Pinpoint with a one-time code,
  // which the pop-up hands to this window and closes.
  async function connect() {
    const { verifier, challenge } = await pkce();
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    localStorage.setItem(VERIFIER, JSON.stringify({ verifier, state }));
    const url = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
      client_id: APP_KEY, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
      redirect_uri: redirectUri(), token_access_type: 'offline', state,
    });
    const pop = window.open(url, 'pinpoint-dropbox', 'width=560,height=720');
    if (!pop) throw new Error('The sign-in window was blocked. Allow pop-ups for this site and try again.');
    return new Promise((resolve, reject) => {
      const onMsg = async (e) => {
        if (e.origin !== location.origin || !e.data || e.data.type !== 'pinpoint-dropbox') return;
        window.removeEventListener('message', onMsg);
        clearInterval(watch);
        try { resolve(await finish(e.data.code, e.data.state, e.data.error)); } catch (err) { reject(err); }
      };
      window.addEventListener('message', onMsg);
      const watch = setInterval(() => {
        if (pop.closed) { clearInterval(watch); window.removeEventListener('message', onMsg); setTimeout(() => reject(new Error('Sign-in window closed.')), 300); }
      }, 700);
    });
  }
  async function finish(code, state, error) {
    const saved = JSON.parse(localStorage.getItem(VERIFIER) || 'null');
    localStorage.removeItem(VERIFIER);
    if (error) throw new Error(error === 'access_denied' ? 'Dropbox access was not allowed.' : error);
    if (!saved || saved.state !== state || !code) throw new Error('Sign-in didn’t complete. Try again.');
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: APP_KEY, redirect_uri: redirectUri(), code_verifier: saved.verifier }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error_description || d.error || 'Dropbox sign-in failed');
    auth = { refresh: d.refresh_token, access: d.access_token, expires: Date.now() + (d.expires_in - 60) * 1000, root: (auth && auth.root) || null };
    const me = await rpc('users/get_current_account', null);
    auth.name = me.name && me.name.display_name;
    save(auth);
    return auth;
  }
  // In the pop-up: when Dropbox sends us back with ?code=…, pass it on.
  (function handleReturn() {
    const q = new URLSearchParams(location.search);
    if (!(q.has('code') || q.has('error')) || !q.has('state')) return;
    const msg = { type: 'pinpoint-dropbox', code: q.get('code'), state: q.get('state'), error: q.get('error') };
    history.replaceState(null, '', location.pathname);
    if (window.opener && !window.opener.closed) {
      DT.dropboxPopup = true; // main.js stays idle in this window
      window.opener.postMessage(msg, location.origin);
      document.addEventListener('DOMContentLoaded', () => {
        document.body.innerHTML = '<p style="font:15px system-ui;padding:40px">Connected. You can close this window.</p>';
      });
      setTimeout(() => window.close(), 600);
    }
  })();

  async function token() {
    if (!auth || !auth.refresh) throw new Error('Not connected to Dropbox');
    if (auth.access && Date.now() < auth.expires) return auth.access;
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: APP_KEY }),
    });
    const d = await res.json();
    if (!res.ok) { if (d.error === 'invalid_grant') { disconnect(); throw new Error('Dropbox sign-in expired. Connect again.'); } throw new Error(d.error_description || 'Dropbox error'); }
    auth.access = d.access_token;
    auth.expires = Date.now() + (d.expires_in - 60) * 1000;
    save(auth);
    return auth.access;
  }
  // Dropbox wants non-ASCII characters in this header escaped.
  const argHeader = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  async function call(url, init, retry = true) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + await token() } });
    if (res.status === 401 && retry) { auth.access = null; return call(url, init, false); }
    if (res.status === 429 && retry) { await new Promise(r => setTimeout(r, 2000)); return call(url, init, false); }
    if (!res.ok) {
      let msg = 'Dropbox error ' + res.status;
      try { const d = await res.json(); msg = d.error_summary || msg; } catch (e) { /* not JSON */ }
      throw new Error(msg);
    }
    return res;
  }
  async function rpc(path, body) {
    const res = await call('https://api.dropboxapi.com/2/' + path, body == null ? { method: 'POST' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  }
  async function list(path) {
    let d = await rpc('files/list_folder', { path: path || '', recursive: false, include_non_downloadable_files: false });
    const out = [...d.entries];
    while (d.has_more) { d = await rpc('files/list_folder/continue', { cursor: d.cursor }); out.push(...d.entries); }
    return out;
  }
  async function download(path) {
    const res = await call('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': argHeader({ path }) } });
    return res.blob();
  }
  async function upload(path, blob) {
    const res = await call('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': argHeader({ path, mode: 'overwrite', autorename: false, mute: true }) },
      body: blob,
    });
    return res.json();
  }
  function disconnect() {
    const t = auth && (auth.access || null);
    auth = null; save(null);
    if (t) fetch('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).catch(() => {});
  }
  function setRoot(path) { if (auth) { auth.root = path; save(auth); } }

  DT.dropbox = {
    get connected() { return !!(auth && auth.refresh); },
    get name() { return auth && auth.name; },
    get root() { return auth && auth.root; },
    connect, disconnect, setRoot, list, download, upload,
  };
})(window.DT = window.DT || {});
