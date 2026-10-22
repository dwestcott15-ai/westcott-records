/* westcottrecords.com runtime: gives the catalog page the same window.claude API it has on claude.ai,
   backed by Supabase (database + storage) and a small edge function that relays DJ to Anthropic.
   Nothing here is secret: the publishable key is public by design; the owner key lives only in the
   owner's own browser (saved from the private #owner-... link) and is sent as a header on each call. */
(() => {
  const SUPA_URL = 'https://sioplmppjfgkexrbxmca.supabase.co';
  const SUPA_KEY = 'sb_publishable_dhrcm8eAKsILEOWhviA-aA_XFlF9tjI';
  const BUCKET = 'covers';

  // ---- owner key: #owner-<key> on the link stores it on this device, then is removed from the address bar
  let ownerKey = null;
  const om = location.hash.match(/^#owner-([A-Za-z0-9_-]{16,})$/);
  if (om) { try { localStorage.setItem('wr-owner', om[1]); } catch (e) {} history.replaceState(null, '', location.pathname + location.search); }
  if (location.hash === '#signout') { try { localStorage.removeItem('wr-owner'); localStorage.removeItem('wr-guest'); } catch (e) {} history.replaceState(null, '', location.pathname); }
  try { ownerKey = localStorage.getItem('wr-owner'); } catch (e) {}
  // ---- guest password: #guest-<word> on the QR link, or typed at the door; stored on this device
  let guestKey = null;
  const gm = location.hash.match(/^#guest-(.+)$/);
  if (gm) { try { localStorage.setItem('wr-guest', decodeURIComponent(gm[1])); } catch (e) {} history.replaceState(null, '', location.pathname + location.search); }
  try { guestKey = localStorage.getItem('wr-guest'); } catch (e) {}
  // an owner/guest/signout link opened into an already-loaded tab only changes the hash; reload so the key is picked up
  window.addEventListener('hashchange', () => { if (/^#(owner-|guest-|signout$)/.test(location.hash)) location.reload(); });
  const hdrs = () => (ownerKey ? { 'x-owner-key': ownerKey } : guestKey ? { 'x-guest-key': guestKey } : {});

  if (!window.supabase) { console.warn('supabase-js did not load; the site runs read-only'); return; }
  const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, { global: { headers: hdrs() }, realtime: { params: { eventsPerSecond: 5 } } });

  // ---- the door: without a key the page stays locked
  let guestVerified = null;
  async function verifyGuest() {
    if (guestVerified !== null) return guestVerified;
    if (!guestKey) return (guestVerified = false);
    try { const { data, error } = await sb.rpc('check_guest', { key: guestKey }); guestVerified = !error && data === true; } catch (e) { guestVerified = false; }
    if (!guestVerified) { try { localStorage.removeItem('wr-guest'); } catch (e) {} guestKey = null; }
    return guestVerified;
  }
  function showGate(msg) {
    if (document.getElementById('wrgate')) return;
    const g = document.createElement('div'); g.id = 'wrgate';
    g.innerHTML = `<style>#wrgate{position:fixed;inset:0;z-index:100000;background:#131415;color:#ebe8e0;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;font-family:"Barlow","Helvetica Neue",Arial,sans-serif;padding:24px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px));box-sizing:border-box}#wrgate .box{max-width:420px;width:100%;min-width:0;text-align:center}#wrgate h1{font-family:"Barlow Condensed","Arial Narrow",Impact,sans-serif;text-transform:uppercase;font-size:40px;line-height:.95;margin:0 0 10px}#wrgate p{color:#9b9890;margin:0 0 22px;line-height:1.5}#wrgate form{display:flex;gap:8px}#wrgate input{flex:1;min-width:0;font:inherit;font-size:17px;padding:12px 14px;border-radius:6px;border:1px solid #2f3236;background:#1c1e20;color:#ebe8e0}#wrgate button{font:inherit;font-weight:600;padding:12px 18px;border-radius:6px;border:0;background:#e24c40;color:#fff;cursor:pointer}#wrgate .err{color:#e24c40;margin-top:12px;min-height:1.4em}#wrgate .disc{width:84px;height:84px;border-radius:50%;margin:0 auto 22px;background:radial-gradient(circle,#e24c40 0 18%,#ebe8e0 19% 21%,transparent 22%),repeating-radial-gradient(circle,#1a1a1a 0 2px,#303030 2px 4px)}</style>
      <div class="box"><div class="disc"></div><h1>The Westcott Collection</h1><p>This crate is private. Scan the code at the house, or type the password.</p>
      <form><input type="password" autocomplete="off" autocapitalize="none" placeholder="Password" aria-label="Password"><button type="submit">Open</button></form><div class="err">${msg || ''}</div></div>`;
    document.body.appendChild(g);
    g.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault(); const v = g.querySelector('input').value.trim(); if (!v) return;
      const { data } = await sb.rpc('check_guest', { key: v });
      if (data === true) { try { localStorage.setItem('wr-guest', v); } catch (e2) {} location.reload(); }
      else g.querySelector('.err').textContent = 'That isn\'t it. Ask whoever owns the records.';
    });
    setTimeout(() => g.querySelector('input').focus(), 50);
  }

  let ownerVerified = null;
  async function verifyOwner() {
    if (ownerVerified !== null) return ownerVerified;
    if (!ownerKey) return (ownerVerified = false);
    try { const { data, error } = await sb.rpc('check_owner', { key: ownerKey }); ownerVerified = !error && data === true; }
    catch (e) { ownerVerified = false; }
    if (!ownerVerified) { try { localStorage.removeItem('wr-owner'); } catch (e) {} ownerKey = null; }
    return ownerVerified;
  }

  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
  const mapErr = (e) => { const s = e?.code || e?.status; if (s === 'PGRST301' || s === '42501' || s === 401 || s === 403) return err('permission_denied', e.message); return err('invalid_argument', e?.message || String(e)); };
  const mint = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // ---- docs table: one row per document, keyed by (coll, id); data is the document body
  const docSnap = (row) => ({ id: row.id, exists: true, data: () => row.data, metadata: {} });
  const collSnap = (rows) => ({ docs: rows.map(docSnap), size: rows.length, empty: !rows.length, docChanges: () => [], metadata: {} });
  const listeners = new Set();   // {coll, id?, fn, order}
  let channel = null, pollTimer = null;
  function wake() {
    if (channel) return;
    channel = sb.channel('docs-live').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, (payload) => {
      const coll = payload.new?.coll || payload.old?.coll; if (!coll) return;
      listeners.forEach(l => { if (l.coll === coll) l.refresh(); });
    }).subscribe(() => {});
    if (!pollTimer) pollTimer = setInterval(() => { if (document.visibilityState === 'visible') listeners.forEach(l => l.refresh()); }, ownerVerified ? 60000 : 25000);
  }
  async function fetchColl(coll, order) {
    let q = sb.from('docs').select('id,data').eq('coll', coll);
    const { data, error } = await q; if (error) throw mapErr(error);
    const rows = data || [];
    if (order) rows.sort((a, b) => { const x = a.data?.[order] ?? '', y = b.data?.[order] ?? ''; return x < y ? -1 : x > y ? 1 : 0; });
    return rows;
  }
  function collection(coll) {
    let order = null;
    const api = {
      orderBy(f) { order = f; return api; }, where() { return api; }, limit() { return api; },
      doc(id) { return doc(coll + '/' + (id || mint())); },
      async add(body) { const r = doc(coll + '/' + mint()); await r.set(body); return r; },
      async get() { return collSnap(await fetchColl(coll, order)); },
      onSnapshot(fn, onErr) {
        const l = { coll, refresh: async () => { try { fn(collSnap(await fetchColl(coll, order))); } catch (e) { onErr?.(e); } } };
        listeners.add(l); l.refresh(); wake();
        return () => listeners.delete(l);
      },
    };
    return api;
  }
  function doc(path) {
    const parts = path.split('/'); const id = parts.pop(); const coll = parts.join('/');
    const ref = {
      id, path,
      async get() { const { data, error } = await sb.from('docs').select('id,data').eq('coll', coll).eq('id', id).maybeSingle(); if (error) throw mapErr(error); return data ? docSnap(data) : { id, exists: false, data: () => undefined }; },
      async set(body) {
        let { error } = await sb.from('docs').upsert({ coll, id, data: body, updated_at: new Date().toISOString() }, { onConflict: 'coll,id' });
        // guests manage the pull list once setup3.sql is in; before that, fall back to the append-only request
        if (error && path === 'state/pull' && !ownerVerified) ({ error } = await sb.rpc('pull_request', { rids: Array.isArray(body.items) ? body.items : [] }));
        if (error) throw mapErr(error); listeners.forEach(l => { if (l.coll === coll) l.refresh(); }); },
      async update(partial) { const cur = await ref.get(); await ref.set({ ...(cur.exists ? cur.data() : {}), ...partial }); },
      async delete() { const { error } = await sb.from('docs').delete().eq('coll', coll).eq('id', id); if (error) throw mapErr(error); listeners.forEach(l => { if (l.coll === coll) l.refresh(); }); },
      collection(sub) { return collection(path + '/' + sub); },
      onSnapshot(fn, onErr) {
        const l = { coll, refresh: async () => { try { fn(await ref.get()); } catch (e) { onErr?.(e); } } };
        listeners.add(l); l.refresh(); wake();
        return () => listeners.delete(l);
      },
    };
    return ref;
  }
  const db = { collection, doc };

  // ---- DJ: the edge function holds the Anthropic key and relays the request
  async function callDj(body, signal) {
    const r = await fetch(SUPA_URL + '/functions/v1/dj', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, ...hdrs() }, body: JSON.stringify(body) });
    let out = null; try { out = await r.json(); } catch (e) {}
    if (!r.ok) { const code = out?.error || (r.status === 429 ? 'rate_limited' : r.status === 402 || r.status === 503 ? 'sampling_disabled' : 'unknown'); throw err(code, out?.message || `DJ relay returned ${r.status}`); }
    return out;
  }
  const toB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  async function packImages(images) { const out = []; for (const b of images || []) out.push({ data: await toB64(b), mediaType: b.type || 'image/jpeg' }); return out; }
  const sample = async (input, opts = {}) => {
    try {
      const out = await callDj({ input, json: false, modelTier: opts.modelTier || 'quick', images: await packImages(opts.images) }, opts.signal);
      if (opts.onText) opts.onText({ text: out.text, delta: out.text });
      return { text: out.text, truncated: false };
    } catch (e) { if (e.name === 'AbortError') throw err('cancelled'); throw e; }
  };
  sample.json = async (input, opts = {}) => {
    try { const out = await callDj({ input, json: true, modelTier: opts.modelTier || 'quick', images: await packImages(opts.images) }, opts.signal); return out.json; }
    catch (e) { if (e.name === 'AbortError') throw err('cancelled'); throw e; }
  };
  sample.limits = async () => ({ maxPromptBytes: 400000, images: { maxCount: 1, maxInputBytes: 5e6, mediaTypes: ['image/jpeg', 'image/png', 'image/webp'] } });

  // ---- sleeve photos: uploaded through the relay (which checks the owner key) into public storage
  const assets = {
    async upload(blob, meta = {}) { const out = await callDj({ op: 'upload', data: await toB64(blob), type: meta.type || blob.type || 'image/jpeg' }); return { id: out.id, url: out.url }; },
    async delete(id) { await callDj({ op: 'delete', id }); return { deleted: true }; },
  };
  window.__blobUrl = (id) => /^https?:/.test(id) ? id : `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${id}`;

  (async () => {
    const owner = await verifyOwner();
    if (!owner) { const g = await verifyGuest(); if (!g) showGate(); }
    else { try { const { data } = await sb.from('docs').select('data').eq('coll', 'data/users/owner').eq('id', 'settings').maybeSingle(); if (data?.data?.guestKey) window.__guestUrl = 'https://westcottrecords.com/#guest-' + encodeURIComponent(data.data.guestKey); } catch (e) {} }
  })();
  const user = { can: async (perm) => perm === 'data.write' ? await verifyOwner() : perm === 'pull.request' ? (await verifyOwner()) || (await verifyGuest()) : true, id: async () => (await verifyOwner()) ? 'owner' : null, isOwner: () => !!ownerVerified, canEdit: () => !!ownerVerified };
  const downloads = { save: async ({ filename, data }) => { const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return { status: 'saved' }; } };

  window.claude = { use: async (name) => ({ db, sample, assets, user, downloads })[name] || null };
  window.__wr = { signOut() { try { localStorage.removeItem('wr-owner'); localStorage.removeItem('wr-guest'); } catch (e) {} location.reload(); } };
})();
