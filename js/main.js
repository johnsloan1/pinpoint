// Pinpoint — main app: state, undo/redo, sidebar, editor panels,
// mouse dragging, saving and exporting.
(function (DT) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MI = 1609.344, FT = 0.3048;
  const { projection: PJ, places: PL, services: SV, render: RD, layout: LY, icons: IC } = DT;

  const SCHOOL_NOTE_TEXT = 'School information deemed reliable but not guaranteed. Buyer to verify school assignment.';
  const SCHOOL_CATS = ['public_school', 'private_school', 'charter_school'];
  const LOT_NOTE_TEXT = '*lot lines approximate';
  const FONTS = ['Montserrat', 'Inter', 'Poppins', 'Barlow', 'Oswald', 'Roboto Condensed', 'Lato', 'Playfair Display'];
  const DEFAULT_STYLE = {
    font: 'Montserrat', fontWeight: 700, fontSize: 15,
    boxStyle: 'light', boxBg: '#ffffff', textColor: '#16181d', boxOpacity: 1, radius: 7,
    borderWidth: 0, borderColor: '#ffffff',
    showIcons: true, iconShape: 'rounded',
    lineColor: '#ffffff', lineWidth: 2.2, lineDash: 'solid',
    dotSize: 5, dotColorMode: 'category', dotColor: '#ffffff', dotRing: 1.6,
    leader: 70,
    pinColor: '#e11d48', pinSize: 62,
    showDrive: false, driveMode: 'both',
    schoolNote: false, schoolNoteText: SCHOOL_NOTE_TEXT, schoolNoteSize: 10, schoolNotePos: 'bottom-right',
    showLot: false, lotColor: '#ffffff', lotWidth: 2.5, lotFill: 0, lotDash: 'solid', lotNote: true, lotNoteText: LOT_NOTE_TEXT, popGray: 1, popDark: 0, popSky: true,
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  function newProject() {
    return { app: 'drone-tag', version: 1, address: '', house: null, categories: clone(PL.DEFAULT_CATEGORIES),
      places: {}, photos: [], style: clone(DEFAULT_STYLE), master: 3, fetched: null, bodyHeadingV2: true };
  }

  // ---------------- State ----------------
  let S = newProject();
  let assets = new Map();     // photo name -> { file, bitmap, url }  (per property)
  let geom = new Map();       // place id -> { kind, samples, centroid }  (per property)
  let cur = 0;                // current photo index
  let sel = null;             // { kind: 'place'|'house'|'cat', id }
  let tab = 'item';
  let scene = null;
  let mode = null;            // 'addCustom'
  let logos = [];             // logo library
  const logoImages = new Map();
  const measureCtx = document.createElement('canvas').getContext('2d');

  const photo = () => S.photos[cur];
  // Lot lines belong to one photo each (not shared across the property).
  const curLot = () => { const p = S.photos[cur]; return (p && p.lot) || null; };
  // Eye-level photos (not from a drone, or no GPS / camera direction) get no
  // camera math at all: no automatic callouts and no warnings. You tick the
  // places you want and drag them into position yourself.
  const isGround = (meta) => !(meta.hasDirection && meta.hasGps);
  const camFor = (ph) => ph && !ph.ground ? PJ.buildCamera(ph, S.house) : null;
  const catById = (id) => S.categories.find(c => c.id === id);

  // ---------------- Undo / redo ----------------
  let hist = { stack: [], i: -1 };
  function commit() {
    try { syncMemory(); } catch (e) { console.warn(e); }
    hist.stack = hist.stack.slice(0, hist.i + 1);
    hist.stack.push(JSON.stringify(S));
    if (hist.stack.length > 200) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    updateUndo();
  }
  function resetHistory() { hist.stack = []; hist.i = -1; commit(); }
  function undo() { if (hist.i > 0) { hist.i--; S = JSON.parse(hist.stack[hist.i]); if (jobs[ji]) jobs[ji].S = S; afterLoad(); } }
  function redo() { if (hist.i < hist.stack.length - 1) { hist.i++; S = JSON.parse(hist.stack[hist.i]); if (jobs[ji]) jobs[ji].S = S; afterLoad(); } }
  function afterLoad() {
    cur = Math.min(cur, Math.max(0, S.photos.length - 1));
    if (mode === 'mask') maskSync();
    if (sel && sel.kind === 'place' && !S.places[sel.id]) sel = null;
    syncGlobalControls();
    renderAll();
    updateUndo();
  }
  function updateUndo() {
    $('#btnUndo').disabled = hist.i <= 0;
    $('#btnRedo').disabled = hist.i >= hist.stack.length - 1;
  }

  // ---------------- Status / busy ----------------
  function setStatus(msg, kind = '') {
    const el = $('#status');
    el.textContent = msg || '';
    el.className = 'status ' + kind;
  }
  let busyMsg = null;
  function busy(msg) {
    busyMsg = msg || null;
    $('#busy').hidden = !msg;
    if (msg) $('#busyText').textContent = msg;
  }

  // ---------------- Photos ----------------
  // Which compass reading to trust, per camera model. Every drone starts on
  // "drone body": the camera faces where the drone faces, and the gimbal's
  // own heading was 19–26° off in test photos (Nov 2026) while the body
  // heading was within ~4°. A choice you make is remembered per camera.
  // (Stored under a new name so older remembered "gimbal" choices are dropped.)
  let cameraPrefs = {};
  function defaultHeading(meta) {
    const model = meta.model || '';
    if (cameraPrefs[model]) return cameraPrefs[model];
    return meta.flightYaw != null ? 'body' : 'gimbal';
  }

  function newPhoto(name, W, H, meta) {
    return {
      name, W, H, meta,
      adj: { dYaw: 0, dPitch: 0, dRoll: 0, zoom: 1, height: null, manual: !meta.hasDirection, heading: defaultHeading(meta),
        mYaw: 0, mPitch: -20, mHeight: 61, mDist: 150, mBearing: 180 },
      layout: {}, hidden: {}, house: null, pin: true, ground: isGround(meta),
    };
  }

  async function makeDisplayBitmap(file) {
    const full = await createImageBitmap(file);
    const W = full.width, H = full.height;
    const k = Math.min(1, 2600 / Math.max(W, H));
    if (k === 1) return { W, H, bitmap: full };
    const c = document.createElement('canvas');
    c.width = Math.round(W * k); c.height = Math.round(H * k);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, 0, 0, c.width, c.height);
    full.close && full.close();
    const bitmap = await createImageBitmap(c);
    return { W, H, bitmap };
  }

  // ---------------- Properties (several jobs at once) ----------------
  // Each property is its own job: photos, address, places, lot lines, undo.
  // New photos are sorted into properties by folder name, file name
  // (“123 Main St 03.jpg”) and GPS/time; the address is then looked up
  // automatically. Typing it in is the last resort.
  let jobs = [];
  let ji = 0;
  let defaultPresetCache = null;
  const jobId = () => 'job' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function makeJob(state) {
    let st = state;
    if (!st) {
      const keep = S;
      S = newProject();
      if (defaultPresetCache) { const ss = setStatus; setStatus = () => {}; try { applyPreset(defaultPresetCache); } finally { setStatus = ss; } } else applyPlaceTypes();
      st = S; S = keep;
    }
    st.jobId = st.jobId || jobId();
    return { S: st, hist: { stack: [JSON.stringify(st)], i: 0 }, geom: new Map(), assets: new Map(), cur: 0 };
  }
  function stashJob() { const j = jobs[ji]; if (j) { j.S = S; j.hist = hist; j.geom = geom; j.assets = assets; j.cur = cur; } }
  function loadJob(i) {
    ji = i;
    const j = jobs[i];
    S = j.S; hist = j.hist; geom = j.geom; assets = j.assets; cur = Math.min(j.cur || 0, Math.max(0, S.photos.length - 1));
  }
  const jobBusy = () => fetching || lotBusy || !!busyMsg;
  async function switchJob(i) {
    if (i === ji || !jobs[i]) return;
    if (jobBusy()) { setStatus('Wait a moment, this property is still loading.', 'error'); return; }
    if (mode) { drawPts = []; endMode(); }
    stashJob();
    loadJob(i);
    sel = null; view.name = null;
    syncGlobalControls();
    renderAll();
    updateUndo();
    setStatus(jobHint(S));
    loadPlacesIfNeeded();
  }
  function jobHint(st) {
    if (st.addrState === 'looking') return 'Looking up this property’s address…';
    if (!st.house) return 'Type this property’s address on the left and click Find places.';
    if (st.addrState === 'check') return `Address ${st.addrNote || 'found approximately'}. Check it’s right; if not, type the correct one and click Find places.`;
    return '';
  }
  async function loadPlacesIfNeeded() {
    if (!S.house || jobBusy()) return;
    const fetchedAny = S.fetched && Object.keys(S.fetched.radii || {}).length;
    if (fetchedAny) return;
    S.fetched = S.fetched || { lat: S.house.lat, lon: S.house.lon, radii: {} };
    mergeMyPlaces();
    await fetchPlaces();
    const h = jobHint(S);
    if (h) setStatus(h);
  }
  function newJob() {
    if (jobBusy()) { setStatus('Wait a moment, this property is still loading.', 'error'); return; }
    stashJob();
    jobs.push(makeJob());
    loadJob(jobs.length - 1);
    sel = null; view.name = null;
    syncGlobalControls(); renderAll(); updateUndo();
    setStatus('New property. Add its photos, or type its address and click Find places.');
    $('#address').focus();
  }
  function removeJob(i) {
    const j = jobs[i];
    if (!j) return;
    if (jobBusy()) { setStatus('Wait a moment, a property is still loading.', 'error'); return; }
    stashJob();
    for (const a of j.assets.values()) { a.bitmap.close && a.bitmap.close(); URL.revokeObjectURL(a.url); }
    jobs.splice(i, 1);
    if (!jobs.length) jobs.push(makeJob());
    loadJob(Math.min(i === ji ? i : (i < ji ? ji - 1 : ji), jobs.length - 1));
    sel = null; view.name = null;
    syncGlobalControls(); renderAll(); updateUndo();
    setStatus(`Removed ${jobLabel(j.S)}.`, 'ok');
  }
  function jobLabel(st) {
    if (st.address) return st.address.split(',')[0];
    if (st.addrHint) return st.addrHint;
    return 'New property';
  }
  let confirmRemoveJob = null;
  function renderJobBar() {
    const el = $('#jobBar');
    const any = jobs.length > 1 || jobs.some(j => (j === jobs[ji] ? S : j.S).photos.length);
    el.hidden = !any;
    if (!any) return;
    el.innerHTML = jobs.map((j, i) => {
      const st = i === ji ? S : j.S;
      const state = st.addrState === 'looking' ? 'looking' : !st.house ? 'need' : st.addrState === 'check' ? 'check' : 'ok';
      const tip = { looking: 'Looking up the address…', need: 'Needs an address', check: 'Address found approximately: check it', ok: 'Address found' }[state];
      const n = st.photos.length, g = st.photos.filter(p => p.ground).length;
      return `<div class="job ${i === ji ? 'cur' : ''}" data-job="${i}" title="${esc(tip)}">
        <span class="job-dot ${state}"></span>
        <span class="job-name">${esc(jobLabel(st))}</span>
        <span class="job-count">${n} photo${n === 1 ? '' : 's'}${g ? ` · ${g} eye-level` : ''}</span>
        ${confirmRemoveJob === i ? '<button class="job-x confirm" data-job-x="' + i + '">Remove?</button>' : `<button class="job-x" data-job-x="${i}" title="Remove this property">✕</button>`}
      </div>`;
    }).join('') + '<button class="job-add" id="jobAdd" title="Start another property">+ New property</button>';
  }
  $('#jobBar').addEventListener('click', (e) => {
    const x = e.target.closest('[data-job-x]');
    if (x) {
      e.stopPropagation();
      const i = +x.dataset.jobX;
      const st = i === ji ? S : jobs[i].S;
      if (!st.photos.length || confirmRemoveJob === i) { confirmRemoveJob = null; removeJob(i); }
      else { confirmRemoveJob = i; renderJobBar(); setTimeout(() => { if (confirmRemoveJob === i) { confirmRemoveJob = null; renderJobBar(); } }, 4000); }
      return;
    }
    if (e.target.closest('#jobAdd')) { newJob(); return; }
    const j = e.target.closest('[data-job]');
    if (j) switchJob(+j.dataset.job);
  });

  // ---- Reading an address out of a file or folder name ----
  // “123 Main St 03.jpg”, “123_Main_St-edit.jpg”, a folder named
  // “123 Main St” … → “123 Main St”. DJI_0001 / IMG_1234 → nothing.
  const STOP_WORDS = /^(dji|img|dsc|dscn|pxl|mvimg|edit|edited|final|aerial|aerials|drone|photo|photos|pic|hdr|pano|panorama|twilight|copy|web|mls|print|hires|lores|hi|lo|res|callouts?|export|exports|jpg|jpeg|raw|selects?|day|dusk)$/i;
  const STREET_TYPES = /^(st|street|dr|drive|rd|road|ln|lane|ct|court|cir|circle|blvd|boulevard|ave|avenue|way|trl|trail|pkwy|parkway|pl|place|ter|terrace|cv|cove|loop|hwy|highway|pass|path|run|xing|crossing|sq|square|pt|point|bnd|bend|holw|hollow|vw|view|rdg|ridge|cres|crescent|row|walk|aly|alley|plz|plaza|fm|cr)$/i;
  function addressFromName(raw) {
    if (!raw) return null;
    const t = raw.replace(/\.(jpe?g|png|heic|tiff?)$/i, '').replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim();
    const re = /(^|[^A-Za-z0-9])(\d{1,6}[A-Za-z]?)\s+([NSEW]\.?\s+)?([A-Za-z][A-Za-z'.]*(?:\s+[A-Za-z0-9][A-Za-z0-9'.]*){0,6})/g;
    let m;
    while ((m = re.exec(t))) {
      const before = t.slice(0, m.index + m[1].length).trim().split(/\s+/).pop() || '';
      if (/^(dji|img|dsc|dscn|pxl|mvimg)$/i.test(before)) continue; // camera numbering, not an address
      const words = m[4].split(/\s+/);
      const keep = [];
      for (const w of words) {
        if (STOP_WORDS.test(w.replace(/\./g, ''))) break;
        // A number only belongs to the street after FM / County Road / Hwy…; otherwise it's a photo number.
        if (/^\d/.test(w)) {
          const prev = (keep[keep.length - 1] || '').replace(/\./g, ''), prev2 = (keep[keep.length - 2] || '').replace(/\./g, '');
          const roadNum = !/^0/.test(w) && (/^(fm|cr|hwy|highway|route|rte|sh|us|ih|loop|spur|rr)$/i.test(prev) || (/^(rd|road)$/i.test(prev) && /^(county|co|private|pvt)$/i.test(prev2)));
          if (!roadNum) break;
        }
        keep.push(w);
      }
      if (!keep.length || !keep.some(w => /[A-Za-z]{2,}/.test(w))) continue;
      // Trim anything after the (last) street type (“Dr”, “Lane”…), e.g. a city or a note.
      let ti = -1;
      keep.forEach((w, k) => { if (k > 0 && STREET_TYPES.test(w.replace(/\./g, ''))) ti = k; });
      if (ti > 0 && /^\d/.test(keep[ti + 1] || '')) ti++; // “County Road 2756”
      const street = (ti > 0 ? keep.slice(0, ti + 1) : keep).join(' ');
      return `${m[2]} ${m[3] || ''}${street}`.replace(/\s+/g, ' ').trim();
    }
    return null;
  }
  const normAddr = (a) => a.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(drive|street|road|lane|court|circle|boulevard|avenue|parkway|trail|place)\b/g, (w) => ({ drive: 'dr', street: 'st', road: 'rd', lane: 'ln', court: 'ct', circle: 'cir', boulevard: 'blvd', avenue: 'ave', parkway: 'pkwy', trail: 'trl', place: 'pl' }[w])).replace(/\s+/g, ' ').trim();

  // ---- Sorting new photos into properties ----
  const GROUP_M = 450;          // photos of one property are taken within this distance
  const GAP_MS = 45 * 60e3;     // …and usually within this time of each other
  const tOf = (meta) => meta.date ? Date.parse(meta.date) : null;
  function photoSpot(meta) { return meta.hasGps ? { lat: meta.lat, lon: meta.lon } : null; }
  function stateSpots(st) { return st.photos.map(p => photoSpot(p.meta)).filter(Boolean); }
  function centerOf(spots) {
    if (!spots.length) return null;
    return { lat: spots.reduce((a, p) => a + p.lat, 0) / spots.length, lon: spots.reduce((a, p) => a + p.lon, 0) / spots.length };
  }
  function sortIntoGroups(items) {
    // 1) Folder or file-name address decides when there is one.
    const groups = [];
    const byKey = new Map();
    const keyed = [], loose = [];
    for (const it of items) {
      const hint = addressFromName(it.folder) || addressFromName(it.file.name);
      it.hint = hint;
      it.key = hint ? 'addr:' + normAddr(hint) : it.folder && it.folderSub ? 'folder:' + it.folder.toLowerCase() : null;
      (it.key ? keyed : loose).push(it);
    }
    for (const it of keyed) {
      let g = byKey.get(it.key);
      if (!g) { g = { key: it.key, hint: it.hint, folder: it.folder, items: [] }; byKey.set(it.key, g); groups.push(g); }
      if (!g.hint && it.hint) g.hint = it.hint;
      g.items.push(it);
    }
    // 2) Others go with the nearest group by place (drone/phone GPS) and time.
    loose.sort((a, b) => (tOf(a.meta) || 0) - (tOf(b.meta) || 0));
    const near = (g, it) => {
      const sp = photoSpot(it.meta), t = tOf(it.meta);
      let best = Infinity;
      for (const o of g.items) {
        const so = photoSpot(o.meta), to = tOf(o.meta);
        if (sp && so) { const d = PJ.distM(sp.lat, sp.lon, so.lat, so.lon); if (d < GROUP_M && (t == null || to == null || Math.abs(t - to) < GAP_MS * 3)) best = Math.min(best, d); }
        else if (!sp && t != null && to != null && Math.abs(t - to) < GAP_MS) best = Math.min(best, GROUP_M + Math.abs(t - to) / 1000);
      }
      return best;
    };
    const blind = [];
    for (const it of loose) {
      if (!photoSpot(it.meta) && tOf(it.meta) == null) { blind.push(it); continue; }
      let best = null, bd = Infinity;
      for (const g of groups) { const d = near(g, it); if (d < bd) { bd = d; best = g; } }
      if (best) best.items.push(it);
      else groups.push({ key: null, hint: null, folder: null, items: [it] });
    }
    // No GPS and no date (e.g. a phone shot with location off): goes with the
    // biggest group in this batch, or the property on screen.
    if (blind.length) {
      const big = groups.slice().sort((a, b) => b.items.length - a.items.length)[0];
      if (big) big.items.push(...blind); else groups.push({ key: null, hint: null, folder: null, items: blind, here: true });
    }
    return groups;
  }
  function matchJob(g, used) {
    if (g.here) return ji;
    // Same address/folder as a property already open, or taken at the same place.
    for (let i = 0; i < jobs.length; i++) {
      const st = i === ji ? S : jobs[i].S;
      if (g.key && st.jobKey === g.key) return i;
    }
    const gc = centerOf(g.items.map(it => photoSpot(it.meta)).filter(Boolean));
    if (gc) {
      for (let i = 0; i < jobs.length; i++) {
        const st = i === ji ? S : jobs[i].S;
        if (g.key && st.jobKey && st.jobKey !== g.key) continue;
        const c = centerOf(stateSpots(st)) || st.house;
        if (c && PJ.distM(gc.lat, gc.lon, c.lat, c.lon) < GROUP_M) return i;
      }
    }
    // An empty property you just started (or the blank one at launch).
    const cs = S;
    if (!cs.photos.length && !used.has(ji) && (!g.key || !cs.jobKey)) return ji;
    return -1;
  }

  async function addFiles(fileList, folders = new Map()) {
    const files = [...fileList].filter(f => /\.jpe?g$/i.test(f.name) || f.type === 'image/jpeg');
    if (!files.length) return;
    if (jobBusy()) { setStatus('Wait a moment, a property is still loading, then add the photos again.', 'error'); return; }
    busy(`Reading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
    let firstJob = null, firstName = null;
    try {
      const items = [];
      for (const [k, f] of files.entries()) {
        if (files.length > 3) busy(`Reading photo ${k + 1} of ${files.length}…`);
        const meta = await DT.metadata.readMeta(f);
        const { W, H, bitmap } = await makeDisplayBitmap(f);
        const fo = folders.get(f);
        items.push({ file: f, meta, W, H, bitmap, folder: fo ? fo.name : null, folderSub: !!(fo && fo.sub) });
      }
      stashJob();
      const groups = sortIntoGroups(items);
      const used = new Set();
      const touched = [];
      for (const g of groups) {
        let i = matchJob(g, used);
        if (i < 0) { jobs.push(makeJob()); i = jobs.length - 1; }
        used.add(i);
        const j = jobs[i];
        const st = j.S;
        if (g.key && !st.jobKey) st.jobKey = g.key;
        if (g.hint && !st.addrHint) st.addrHint = g.hint;
        for (const it of g.items) {
          const f = it.file;
          const old = j.assets.get(f.name);
          if (old) { old.bitmap.close && old.bitmap.close(); URL.revokeObjectURL(old.url); }
          j.assets.set(f.name, { file: f, bitmap: it.bitmap, url: URL.createObjectURL(f) });
          const p0 = st.photos.find(p => p.name === f.name);
          if (!p0) st.photos.push(newPhoto(f.name, it.W, it.H, it.meta));
          else { p0.meta = it.meta; p0.W = it.W; p0.H = it.H; p0.ground = isGround(it.meta); if (!it.meta.hasDirection) p0.adj.manual = true; }
          if (firstJob == null) { firstJob = i; firstName = f.name; }
        }
        st.photos.sort((a, b) => (a.meta.date || a.name).localeCompare(b.meta.date || b.name) || a.name.localeCompare(b.name));
        j.hist.stack.push(JSON.stringify(st)); j.hist.i = j.hist.stack.length - 1;
        if (!touched.includes(i)) touched.push(i);
      }
      loadJob(ji);
      const target = firstJob ?? ji;
      if (target !== ji) { loadJob(target); sel = null; view.name = null; }
      const ci = S.photos.findIndex(p => p.name === firstName);
      if (ci >= 0) cur = ci;
      syncGlobalControls();
      renderAll(); updateUndo();
      const newJobs = touched.length;
      setStatus(newJobs > 1 ? `Sorted ${files.length} photos into ${newJobs} properties (see the tabs above the photo). Looking up addresses…` : '');
      busy(null);
      // Look up addresses (file/folder name + GPS), one at a time.
      for (const i of touched) { const st = i === ji ? S : jobs[i].S; if (!st.house) await findAddressFor(st); }
      renderJobBar();
      if (!jobBusy()) { setStatus(jobHint(S)); await loadPlacesIfNeeded(); }
    } catch (e) {
      console.error(e);
      setStatus('Could not read a photo: ' + e.message, 'error');
    } finally { busy(null); renderJobBar(); }
  }

  // Where the drone was pointing: the middle of the frame, on the ground.
  // Real-estate shots are framed on the house, so this is a good guess.
  function photoAim(st) {
    for (const ph of st.photos) {
      if (ph.ground) continue;
      const cam = PJ.buildCamera(ph, null);
      const c = cam && PJ.unproject(cam, ph.W / 2, ph.H / 2);
      if (c && PJ.distM(c.lat, c.lon, ph.meta.lat, ph.meta.lon) < 1500) return c;
    }
    return null;
  }
  async function findAddressFor(st) {
    const gps = centerOf(stateSpots(st));
    const aim = photoAim(st);
    const near = aim || gps;
    if (!near && !st.addrHint) return;
    st.addrState = 'looking'; renderJobBar();
    try {
      let g = null;
      if (st.addrHint) g = await SV.geocodeNear(st.addrHint, near);
      const lot = g && await houseFromLot(st.addrHint, g);
      if (lot) setJobAddress(st, g.address, lot, g.label, null);
      else if (g) {
        let house = { lat: g.lat, lon: g.lon }, note = null;
        if (!g.exact && aim && PJ.distM(aim.lat, aim.lon, g.lat, g.lon) < 400) { house = aim; note = 'found on the street; the pin is placed where the drone was aimed'; }
        else if (!g.exact) note = 'found on the street but not the exact house';
        setJobAddress(st, g.address, house, g.label, note);
      } else if (aim) {
        const r = await SV.reverseGeocode(aim.lat, aim.lon);
        if (r) setJobAddress(st, r.address, aim, r.label, st.addrHint ? `for “${st.addrHint}” not found, so this was guessed from where the drone was aimed` : 'guessed from where the drone was aimed');
      }
    } catch (e) { console.warn('Address lookup failed', e); }
    if (st.addrState === 'looking') st.addrState = null;
    if (st === S) { syncGlobalControls(); renderAll(); }
    renderJobBar();
  }
  // The street map's spot for a house number can be on the wrong lot, so
  // the appraisal district's lot with that address is used when found.
  async function houseFromLot(text, g) {
    try {
      const hit = await PL.findAddressLot(text || g.address, g.lat, g.lon);
      return hit && hit.d < 1500 ? { lat: hit.lat, lon: hit.lon } : null;
    } catch (e) { console.warn('Lot address lookup failed', e); return null; }
  }
  function setJobAddress(st, address, house, label, note) {
    st.address = address;
    st.house = { lat: house.lat, lon: house.lon, label };
    st.fetched = null;
    st.addrState = note ? 'check' : 'ok';
    st.addrNote = note;
  }

  function removePhoto(i) {
    const p = S.photos[i];
    if (!p) return;
    S.photos.splice(i, 1);
    cur = Math.min(cur, Math.max(0, S.photos.length - 1));
    commit();
    renderAll();
    setStatus(`Removed ${p.name}. Press ⌘Z to undo.`, 'ok');
  }

  // ---------------- Places ----------------
  function neededRadii() {
    const r = {};
    for (const c of S.categories) {
      if (!c.group || c.used === false || !c.enabled) continue;
      for (const g of [c.group, ...(c.alsoGroups || [])]) r[g] = Math.max(r[g] || 0, c.maxMi);
    }
    const out = {};
    for (const g of ['school', 'highway', 'water', 'park', 'amenity', 'shop', 'attraction', 'extra']) out[g] = Math.min(15, Math.max(1, r[g] || 1)) * MI;
    return out;
  }

  async function findPlaces() {
    const addr = $('#address').value.trim();
    if (!addr) { setStatus('Type the property address first.', 'error'); $('#address').focus(); return; }
    // Same address already found: just retry any searches that didn't finish.
    if (S.house && S.address === addr && S.fetched) {
      const missing = groupsNeeded().filter(g => !(S.fetched.radii[g] > 0));
      return fetchPlaces(missing.length ? missing : null);
    }
    S.address = addr;
    setStatus('Looking up the address…');
    busy('Looking up the address…');
    try {
      const g = await SV.geocode(addr);
      if (!g) { setStatus('Couldn’t find that address. Check the spelling, or add the city and ZIP.', 'error'); return; }
      const lot = await houseFromLot(addr, g);
      if (lot) { g.lat = lot.lat; g.lon = lot.lon; }
      const moved = S.house && PJ.distM(S.house.lat, S.house.lon, g.lat, g.lon) > 200;
      S.house = { lat: g.lat, lon: g.lon, label: g.label };
      S.addrState = 'ok'; S.addrNote = null;
      for (const p of S.photos) p.house = null;
      for (const p of Object.values(S.places)) if (p.lat != null) p.distMi = PJ.distM(g.lat, g.lon, p.lat, p.lon) / MI;
      if (moved || !S.fetched) S.fetched = { lat: g.lat, lon: g.lon, radii: {} };
      if (moved) for (const p of S.photos) delete p.lot; // outlines were for the old address
      mergeMyPlaces();
      busy(null);
      await fetchPlaces();
    } catch (e) {
      console.error(e);
      setStatus('Lookup failed: ' + e.message + '. Check your internet connection and try again.', 'error');
    } finally { busy(null); }
  }

  const GROUP_NAMES = { school: 'schools', park: 'parks', amenity: 'amenities', highway: 'highways', water: 'water', shop: 'shopping', attraction: 'attractions', extra: 'trails & civic places' };
  function groupsNeeded() {
    return ['school', 'park', 'amenity', 'highway', 'water', 'shop', 'attraction', 'extra'].filter(g => S.categories.some(c => (c.group === g || (c.alsoGroups || []).includes(g)) && c.enabled && c.used !== false));
  }

  let fetching = false;
  async function fetchPlaces(onlyGroups) {
    if (!S.house || fetching) return;
    const radii = neededRadii();
    const groups = onlyGroups || groupsNeeded();
    if (!groups.length) { await mergeLandmarks(); commit(); renderAll(); return; }
    fetching = true;
    busy('Finding nearby places…');
    try {
      const res = await PL.providers.osm.search({ lat: S.house.lat, lon: S.house.lon, radii, groups }, (m) => busy(m));
      for (const { place, geom: g } of res.places) {
        const old = S.places[place.id];
        S.places[place.id] = old ? { ...old, lat: place.lat, lon: place.lon, distMi: place.distMi, major: place.major, route: place.route, routes: place.routes,
          cat: old.userCat ? old.cat : place.cat } : place;
        geom.set(place.id, g);
      }
      await mergeLandmarks();
      mergeMyPlaces();
      applyRememberedIcons();
      S.fetched = S.fetched || { lat: S.house.lat, lon: S.house.lon, radii: {} };
      for (const g of res.ok) S.fetched.radii[g] = radii[g];
      commit();
      renderAll();
      const shown = scene ? scene.items.length : 0;
      if (res.failed.length) {
        setStatus(`Found ${res.places.length} places, but the ${res.failed.map(g => GROUP_NAMES[g]).join(' and ')} search timed out (the free map servers are busy). Click Find places again to retry just that part.`, 'error');
      } else {
        const src = res.source === 'built-in' ? ` (built-in DFW map data from ${res.built})` : res.source === 'mixed' ? ' (built-in data + live map servers)' : ' (live map servers)';
        setStatus(`Found ${res.places.length} places nearby${src}. ${shown} callout${shown === 1 ? '' : 's'} placed on this photo.`, 'ok');
      }
    } catch (e) {
      console.error(e);
      setStatus('The free map servers didn’t answer (' + e.message + '). Wait a minute and click Find places again.', 'error');
    } finally { fetching = false; busy(null); }
  }

  // Skylines, airports and business hubs come from a short built-in list.
  async function mergeLandmarks() {
    if (!S.house) return;
    for (const l of await PL.landmarksNear(S.house.lat, S.house.lon)) {
      if (!catById(l.cat)) continue;
      const old = S.places[l.id];
      S.places[l.id] = old ? { ...old, lat: l.lat, lon: l.lon, distMi: l.distMi, route: l.route } : l;
    }
  }

  let refetchTimer = null;
  function maybeRefetch() {
    if (!S.fetched || !S.house) return;
    const need = neededRadii();
    const more = groupsNeeded().filter(g => need[g] > (S.fetched.radii[g] || 0) + 1);
    if (!more.length) return;
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => fetchPlaces(more), 700);
  }

  // ---------------- Drive info ----------------
  function wantsDrive(p) {
    return p.showDrive === 'on' || (p.showDrive !== 'off' && S.style.showDrive);
  }
  function driveText(p) {
    if (!wantsDrive(p) || !p.drive) return null;
    const t = p.drive.min < 1 ? '1 min' : Math.round(p.drive.min) + ' min';
    const d = p.drive.mi < 10 ? p.drive.mi.toFixed(1) + ' mi' : Math.round(p.drive.mi) + ' mi';
    if (S.style.driveMode === 'time') return t + ' drive';
    if (S.style.driveMode === 'distance') return d;
    return t + ' · ' + d;
  }
  let driveBusy = false;
  async function maybeFetchDrive() {
    if (driveBusy || !S.house || !scene) return;
    const need = scene.items.map(it => S.places[it.id]).filter(p => p && wantsDrive(p) && !p.drive && !p.driveFailed && p.lat != null);
    if (!need.length) return;
    driveBusy = true;
    setStatus('Getting drive times…');
    try {
      const dests = [];
      for (const p of need) (p.routes || [p.route || { lat: p.lat, lon: p.lon }]).forEach((r, k) => dests.push({ id: p.id + '#' + k, lat: r.lat, lon: r.lon }));
      const res = await SV.routing.osrm.table(S.house, dests);
      for (const p of need) {
        let best = null;
        for (const [id, v] of Object.entries(res)) if (id.slice(0, id.lastIndexOf('#')) === p.id && (!best || v.min < best.min)) best = v;
        if (best) p.drive = best; else p.driveFailed = true;
      }
      setStatus('Drive times added.', 'ok');
    } catch (e) {
      console.error(e);
      need.forEach(p => { p.driveFailed = true; });
      setStatus('Couldn’t get drive times right now (' + e.message + ').', 'error');
    } finally {
      driveBusy = false;
      redraw();
      renderSidebar();
    }
  }

  // ---------------- Scene ----------------
  function colorsFor(p, cat) {
    const st = S.style;
    const accent = p.iconColor || cat.color;
    let box = '#ffffff', text = '#16181d', iconBg = accent, iconFg = '#ffffff';
    if (st.boxStyle === 'dark') { box = '#16181d'; text = '#ffffff'; }
    else if (st.boxStyle === 'category') { box = accent; text = '#ffffff'; iconBg = 'rgba(255,255,255,0.22)'; }
    else if (st.boxStyle === 'custom') { box = st.boxBg; text = st.textColor; }
    if (p.boxColor) box = p.boxColor;
    if (p.textColor) text = p.textColor;
    return {
      box, text, iconBg, iconFg,
      line: p.lineColor || st.lineColor,
      dot: st.dotColorMode === 'category' ? accent : st.dotColor,
      dotRing: '#ffffff', border: st.borderColor,
    };
  }

  // Lakes vs ponds: decided by size, using the "large lake" setting.
  function sortWater() {
    const lake = catById('lake');
    const min = lake ? lake.minAcres ?? 250 : 250;
    for (const p of Object.values(S.places)) {
      if (p.acres == null || p.userCat) continue;
      p.cat = !p.smallTag && p.acres >= min ? 'lake' : 'pond';
    }
  }
  // Older saved jobs/presets had a single "Bodies of water" category.
  // Categories that were folded into another one (Nov 2026).
  const MERGED_INTO = Object.fromEntries(Object.entries(PL.MERGED).map(([k, v]) => [k, v[0]]));
  const RENAMED = { golf: ['Golf courses'], civic: ['City & town halls'], shopping: ['Shopping & retail'] };
  function migrate() {
    // The house marker is switched on or off per photo, not saved with the style (Nov 2026).
    const pinWas = S.style.showPin;
    delete S.style.showPin;
    for (const p of S.photos) if (p.pin === undefined) p.pin = pinWas !== false;
    // Nov 2026: switch saved photos to the drone-body heading once.
    if (!S.bodyHeadingV2) { for (const p of S.photos) if (p.meta && p.meta.flightYaw != null && p.adj) p.adj.heading = 'body'; S.bodyHeadingV2 = true; }
    // Lot lines used to be shared by every photo of a property (Nov 2026).
    if (S.lot) {
      if (S.style.showLot) for (const p of S.photos) if (!p.ground && !p.lot) p.lot = clone(S.lot);
      delete S.lot;
    }
    for (const [from, to] of Object.entries(MERGED_INTO)) {
      const a = S.categories.find(c => c.id === from), b = catById(to);
      if (a && b && a.used !== false) { b.used = true; if (a.enabled) b.enabled = true; }
    }
    for (const c of S.categories) {
      const d = PL.DEFAULT_CATEGORIES.find(x => x.id === c.id);
      if (d && RENAMED[c.id] && RENAMED[c.id].includes(c.name)) { c.name = d.name; if (d.alsoGroups) c.alsoGroups = clone(d.alsoGroups); }
      if (d && d.alsoGroups && !c.alsoGroups) c.alsoGroups = clone(d.alsoGroups);
    }
    for (const p of Object.values(S.places)) if (MERGED_INTO[p.cat]) { p.kindIcon = p.kindIcon || PL.MERGED[p.cat][1]; p.cat = MERGED_INTO[p.cat]; }
    const known = new Set(PL.DEFAULT_CATEGORIES.map(c => c.id));
    const water = S.categories.find(c => c.id === 'water');
    S.categories = S.categories.filter(c => known.has(c.id) || c.user);
    for (const d of PL.DEFAULT_CATEGORIES) {
      let c = catById(d.id);
      if (!c) {
        c = clone(d);
        if (water && (d.id === 'lake' || d.id === 'pond')) { c.color = water.color; c.icon = water.icon; if (d.id === 'lake') c.maxMi = water.maxMi; }
        const at = S.categories.findIndex(x => x.id === 'custom');
        S.categories.splice(at < 0 ? S.categories.length : at, 0, c);
      }
      for (const k of ['roadTypes', 'minAcres', 'used', 'rangeMax']) if (c[k] === undefined && d[k] !== undefined) c[k] = clone(d[k]);
    }
    for (const p of Object.values(S.places)) if (p.cat === 'water') { p.cat = 'lake'; delete p.userCat; }
  }

  // Places that can be tagged at all on this job (type in use, road type
  // wanted, not a duplicate of one of My places, etc.), ignoring distance.
  function eligiblePlaces() {
    sortWater();
    const mine = Object.values(S.places).filter(p => p.source === 'mine' && p.lat != null);
    const out = [];
    for (const p of Object.values(S.places)) {
      const cat = catById(p.cat);
      if (!cat || cat.used === false) continue;
      if (p.source === 'osm' && mine.some(m => m.cat === p.cat && PJ.distM(m.lat, m.lon, p.lat, p.lon) < 80)) continue; // you saved your own
      if (cat.roadTypes && p.roadType && !cat.roadTypes[p.roadType] && !p.always) continue;
      if (cat.majorOnly && p.source === 'osm' && !p.major) continue;
      out.push({ p, cat });
    }
    return out;
  }
  const inRange = (p, cat) => p.always || p.source === 'custom' || (p.distMi ?? 0) <= Math.max(p.maxMi ?? cat.maxMi, p.farMi || 0) + 1e-9; // farMi: business hubs reach 15 mi
  // Where the place's dot lands on a photo, or null if it isn't in the frame.
  function anchorOn(p, ph, cam) {
    if (p.photoOnly && p.photoOnly !== ph.name) return null;
    const lay = ph.layout[p.id];
    if (lay && lay.anchor) return { x: lay.anchor.x * ph.W, y: lay.anchor.y * ph.H };
    return cam && p.lat != null ? PL.anchorFor(p, geom.get(p.id), cam) : null;
  }
  // On/off for one photo. ph.hidden holds per-photo exceptions to the
  // whole-job setting: true = hidden on this photo, false = shown on it.
  // Eye-level photos start empty: a place shows there only once you tick it.
  const groundPick = (p, ph) => ph && ph.ground && p.photoOnly !== ph.name;
  function shownOn(p, ph) {
    if (groundPick(p, ph)) return ph.hidden[p.id] === false;
    const o = ph && ph.hidden[p.id];
    return o === undefined ? p.enabled !== false : !o;
  }
  function setShownOn(p, ph, v) {
    if (groundPick(p, ph)) { if (v) ph.hidden[p.id] = false; else delete ph.hidden[p.id]; return; }
    if (v === (p.enabled !== false)) delete ph.hidden[p.id]; else ph.hidden[p.id] = !v;
  }

  function buildScene(pi) {
    const ph = S.photos[pi];
    if (!ph) return null;
    const cam = camFor(ph);
    const W = ph.W, H = ph.H, u = RD.unit(W);
    const listed = {}, beyond = {}, raw = [];
    let k = 0;
    for (const { p, cat } of eligiblePlaces()) {
      if (ph.ground) {
        // Eye-level: list everything in range; show what you ticked, at the
        // spot you dragged it to (or a starting spot to drag from).
        if (p.photoOnly && p.photoOnly !== ph.name) continue;
        if (!inRange(p, cat) && p.photoOnly !== ph.name) continue;
        (listed[cat.id] = listed[cat.id] || []).push(p);
        const lay = ph.layout[p.id] || {};
        if (!cat.enabled || !shownOn(p, ph)) continue;
        const a = lay.anchor ? { x: lay.anchor.x * W, y: lay.anchor.y * H } : { x: W * (0.2 + 0.15 * (k % 5)), y: H * (0.62 + 0.08 * (Math.floor(k / 5) % 3)) };
        k++;
        raw.push({ p, cat, a, lay });
        continue;
      }
      const a = anchorOn(p, ph, cam);
      if (!a) continue;
      const lay = ph.layout[p.id] || {};
      const within = inRange(p, cat);
      (within ? listed : beyond)[cat.id] = ((within ? listed : beyond)[cat.id] || []).concat(p);
      if (within && cat.enabled && shownOn(p, ph)) raw.push({ p, cat, a, lay });
    }
    let house = null;
    if (ph.house) house = { x: ph.house.x * W, y: ph.house.y * H };
    else if (cam && S.house) {
      const hp = PJ.project(cam, S.house.lat, S.house.lon);
      if (hp && hp.x > 0 && hp.x < W && hp.y > 0 && hp.y < H) house = { x: hp.x, y: hp.y };
    }
    const items = raw.map(({ p, cat, a, lay }) => {
      const it = { id: p.id, ax: a.x, ay: a.y, title: p.title ?? p.name, sub: driveText(p),
        icon: p.icon || p.kindIcon || cat.icon, colors: colorsFor(p, cat), cat: cat.id };
      it.m = RD.metrics(measureCtx, it, S.style, u);
      it.w = it.m.w; it.h = it.m.h;
      it.fixed = lay.box ? { x: lay.box.x * W, y: lay.box.y * H } : null;
      return it;
    });
    const obstacles = [];
    const showPin = ph.pin !== false;
    if (house && showPin) obstacles.push(RD.pinGeometry(house.x, house.y, S.style, u).rect);
    // Lot lines: the outline's corners are real-world points, so they land
    // in the right place on every photo.
    // Each photo has its own outline (or none).
    let lot = null, lotLines = false, pop = null;
    const L = ph.lot;
    if (L && L.ring && L.ring.length >= 3 && cam) {
      const pts = L.ring.map(([la, lo]) => PJ.project(cam, la, lo));
      // r[2] = 1 means "no line from this corner to the next" (a deleted side).
      if (pts.every(Boolean)) lot = pts.map((p, i) => ({ x: p.x, y: p.y, gap: !!L.ring[i][2] }));
      lotLines = !!lot && L.lines !== false;
      // Color callout: the property stays in color, the rest goes gray.
      if (lot && L.pop) {
        let sky = S.style.popSky !== false ? PJ.horizon(cam) : null;
        if (sky && L.sky) sky = sky.map(p => ({ x: p.x, y: p.y + L.sky * H }));
        pop = { gray: S.style.popGray ?? 1, dark: S.style.popDark || 0, sky };
      }
    }
    // Disclaimers, stacked in one corner. The school one only appears on
    // photos that show a school callout.
    const notes = [];
    if ((lotLines || pop) && S.style.lotNote !== false) notes.push((S.style.lotNoteText ?? LOT_NOTE_TEXT).trim());
    if (S.style.schoolNote && raw.some(r => SCHOOL_CATS.includes(r.cat.id))) notes.push((S.style.schoolNoteText || SCHOOL_NOTE_TEXT).trim());
    const noteLines = notes.filter(Boolean);
    obstacles.push(...RD.notesGeometry(measureCtx, noteLines, S.style, W, H, u));
    const boxes = LY.autoLayout(items, { W, H, leader: S.style.leader * u, pad: 7 * u, dotR: (S.style.dotSize + 3) * u, obstacles });
    for (const it of items) it.box = boxes[it.id];
    return { W, H, style: S.style, items, house, showPin, cam, listed, beyond, notes: noteLines, lot, lotLines, pop };
  }

  // ---------------- Canvas ----------------
  const canvas = $('#view');
  const ctx = canvas.getContext('2d');
  let viewScale = 1;
  // Zoom: z = 1 fits the whole photo in the box (the smallest it gets);
  // x/y = the photo pixel at the top-left corner of the box. The canvas fills
  // the whole middle area, so x/y go negative when there's room around the photo.
  const view = { z: 1, x: 0, y: 0, name: null, cw: 1, ch: 1 };
  const MAX_ZOOM = 8;
  // While drawing or editing lot lines you can zoom out past the photo's
  // edges, so corners can be placed where the lot runs out of frame.
  const MIN_ZOOM_LOT = 0.35;
  const lotEditing = () => mode === 'drawLot' || mode === 'mask' || (sel && sel.kind === 'lot');
  const minZoom = () => lotEditing() ? MIN_ZOOM_LOT : 1;
  function clampView(ph) {
    view.z = Math.max(minZoom(), Math.min(MAX_ZOOM, view.z));
    const sw = view.cw / (viewScale * view.z), sh = view.ch / (viewScale * view.z);
    view.x = sw >= ph.W ? (ph.W - sw) / 2 : Math.max(0, Math.min(ph.W - sw, view.x));
    view.y = sh >= ph.H ? (ph.H - sh) / 2 : Math.max(0, Math.min(ph.H - sh, view.y));
  }
  function resetZoom() { view.z = 1; view.x = 0; view.y = 0; redraw(); }
  const zoomScale = () => viewScale * view.z;

  function redraw() {
    const ph = photo();
    $('#empty').hidden = !!ph;
    canvas.hidden = !ph;
    if (!ph) { scene = null; return; }
    // Mask edits don't move anything, so the layout is reused while masking.
    scene = mode === 'mask' && maskEd && maskEd.scene ? maskEd.scene : buildScene(cur);
    const wrap = $('#canvasWrap');
    const cw = Math.max(1, wrap.clientWidth), ch = Math.max(1, wrap.clientHeight);
    const pad = 24; // breathing room around the photo at "Fit"
    viewScale = Math.max(0.001, Math.min((cw - pad) / ph.W, (ch - pad) / ph.H));
    view.cw = cw; view.ch = ch;
    if (view.name !== ph.name) { view.z = 1; view.x = 0; view.y = 0; view.name = ph.name; }
    clampView(ph);
    const zb = $('#zoomFit');
    zb.hidden = Math.abs(view.z - 1) < 0.001;
    zb.textContent = Math.round(view.z * 100) + '% · Fit';
    $('#pinPlace').hidden = !(S.house && ph.pin !== false && !scene.house && !mode && !ph.ground);
    const dpr = window.devicePixelRatio || 1;
    const cssW = cw, cssH = ch;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const editingLot = lotEditing();
    if (editingLot) { ctx.fillStyle = '#23262c'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    const zs = zoomScale() * dpr;
    ctx.setTransform(zs, 0, 0, zs, -view.x * zs, -view.y * zs);
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 30 * dpr; ctx.shadowOffsetY = 6 * dpr;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ph.W, ph.H);
    ctx.restore();
    // Outside lot editing, show only what the export will contain.
    ctx.save();
    if (!editingLot) { ctx.beginPath(); ctx.rect(0, 0, ph.W, ph.H); ctx.clip(); }
    const a = assets.get(ph.name);
    if (!a) {
      ctx.fillStyle = '#2a2d33';
      ctx.fillRect(0, 0, ph.W, ph.H);
      ctx.fillStyle = '#aab';
      ctx.font = `600 ${ph.W / 40}px Inter, sans-serif`;
      ctx.fillText('Photo not loaded — add “' + ph.name + '” with Add photos', ph.W * 0.05, ph.H * 0.5);
    }
    const selectedId = sel ? (sel.kind === 'house' ? '__house' : sel.id) : null;
    const masking = mode === 'mask' && maskEd;
    const lm = masking ? maskEd.canvas : DT.mask.fromData(ph.lotMask, redraw);
    RD.drawScene(ctx, scene, a && a.bitmap, { selectedId: masking ? null : selectedId, logoImages,
      lotHandles: !masking && sel && sel.kind === 'lot', lotSel: sel && sel.kind === 'lot' ? sel : null, handleR: 7 / zoomScale(), drawPts: mode === 'drawLot' ? drawPts : null,
      lotMask: lm, lotMaskVer: masking ? maskEd.savedVer : 0, popMaxW: 2400,
      maskTint: masking && maskEd.show ? maskEd.tint : null,
      maskPreview: masking && maskEd.preview ? DT.mask.tint(maskEd.preview.canvas, maskEd.preview.op === 'remove' ? 'rgba(255,200,0,0.45)' : maskEd.kind === 'off' ? 'rgba(60,130,255,0.55)' : 'rgba(56,189,248,0.5)', maskEd.preview.id + maskEd.kind) : null });
    if (masking) drawMaskOverlay();
    ctx.restore();
    if (editingLot) {
      // Mark the photo's edge; anything outside it won't be in the export.
      ctx.save();
      ctx.lineWidth = 1.5 / zoomScale();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.setLineDash([6 / zoomScale(), 4 / zoomScale()]);
      ctx.strokeRect(0, 0, ph.W, ph.H);
      ctx.restore();
    }
  }

  function renderAll() {
    redraw();
    renderSidebar();
    renderInspector();
    renderFilmstrip();
    renderBanner();
    renderJobBar();
    maybeFetchDrive();
  }

  function toImage(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoomScale() + view.x, y: (e.clientY - r.top) / zoomScale() + view.y };
  }

  function hitTest(pt) {
    if (!scene) return null;
    const u = RD.unit(scene.W);
    // Lot corner handles (only while the lot lines are selected).
    if (sel && sel.kind === 'lot' && scene.lot) {
      const r = 11 / zoomScale();
      for (let i = 0; i < scene.lot.length; i++) if (Math.hypot(pt.x - scene.lot[i].x, pt.y - scene.lot[i].y) <= r) return { type: 'lotVertex', i };
      for (let i = 0; i < scene.lot.length; i++) {
        const a = scene.lot[i], b = scene.lot[(i + 1) % scene.lot.length];
        if (!a.gap && Math.hypot(pt.x - (a.x + b.x) / 2, pt.y - (a.y + b.y) / 2) <= r) return { type: 'lotMid', i };
      }
      // A side (including deleted ones, so they can be brought back).
      const lt = Math.max(7 / zoomScale(), S.style.lotWidth * RD.unit(scene.W) * 2);
      let best = null;
      for (let i = 0; i < scene.lot.length; i++) {
        const d = segDist(pt, scene.lot[i], scene.lot[(i + 1) % scene.lot.length]);
        if (d <= lt && (!best || d < best.d)) best = { d, i };
      }
      if (best) return { type: 'lotEdge', i: best.i };
    }
    for (let i = scene.items.length - 1; i >= 0; i--) {
      const it = scene.items[i], b = it.box;
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return { type: 'box', id: it.id, it };
    }
    if (scene.house && scene.showPin) {
      const g = RD.pinGeometry(scene.house.x, scene.house.y, S.style, u).rect;
      if (pt.x >= g.x && pt.x <= g.x + g.w && pt.y >= g.y && pt.y <= g.y + g.h + 6 * u) return { type: 'house' };
    }
    const tol = Math.max(S.style.dotSize * u + 4 * u, 10 / zoomScale());
    for (let i = scene.items.length - 1; i >= 0; i--) {
      const it = scene.items[i];
      if (Math.hypot(pt.x - it.ax, pt.y - it.ay) <= tol) return { type: 'dot', id: it.id, it };
    }
    if (scene.lot) {
      const lt = Math.max(6 / zoomScale(), S.style.lotWidth * u * 2);
      for (let i = 0; i < scene.lot.length; i++) {
        const a = scene.lot[i], b = scene.lot[(i + 1) % scene.lot.length];
        if (!a.gap && segDist(pt, a, b) <= lt) return { type: 'lot' };
      }
    }
    return null;
  }

  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!scene) return;
    const pt = toImage(e);
    if (mode === 'addCustom') { addCustomAt(pt); return; }
    if (mode === 'placePin') { placePinAt(pt); return; }
    if (mode === 'drawLot') { addLotPoint(pt); return; }
    if (mode === 'mask') {
      if (spaceHeld || e.button === 1) { drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: true }; canvas.setPointerCapture(e.pointerId); return; }
      maskDown(e, pt); return;
    }
    const hit = hitTest(pt);
    if (hit && (hit.type === 'lotVertex' || hit.type === 'lotMid')) {
      if (hit.type === 'lotMid') {
        const a = curLot().ring[hit.i], b = curLot().ring[(hit.i + 1) % curLot().ring.length];
        curLot().ring.splice(hit.i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        hit.i++;
        sel = { kind: 'lot' };
      }
      drag = { lot: hit.i, sx: e.clientX, sy: e.clientY, moved: hit.type === 'lotMid', cam: scene.cam };
      canvas.setPointerCapture(e.pointerId);
      redraw();
      return;
    }
    if (hit && hit.type === 'lot') { select({ kind: 'lot' }); return; }
    if (hit && hit.type === 'lotEdge') { select({ kind: 'lot', edge: hit.i }); return; }
    if (!hit) {
      // Empty spot: drag to move around a zoomed-in photo; a plain click deselects.
      drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (hit.type === 'house') select({ kind: 'house' });
    else select({ kind: 'place', id: hit.id });
    const ph = photo();
    drag = { hit, start: pt, moved: false, sx: e.clientX, sy: e.clientY,
      box: hit.it ? { ...hit.it.box } : null, anchor: hit.it ? { x: hit.it.ax, y: hit.it.ay } : null,
      house: scene.house ? { ...scene.house } : null, ph };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!scene) return;
    if (mode === 'mask' && !(drag && drag.pan)) { maskMove(e, toImage(e)); return; }
    const pt = toImage(e);
    if (!drag) {
      if (mode === 'addCustom' || mode === 'placePin') { canvas.style.cursor = 'crosshair'; return; }
      const hit = hitTest(pt);
      canvas.style.cursor = hit ? (hit.type === 'box' ? 'grab' : 'move') : view.z > 1 ? 'grab' : 'default';
      return;
    }
    if (drag.lot != null) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
      drag.moved = true;
      const ll = drag.cam && PJ.unproject(drag.cam, pt.x, pt.y);
      if (ll) { const g = curLot().ring[drag.lot][2]; curLot().ring[drag.lot] = g ? [ll.lat, ll.lon, g] : [ll.lat, ll.lon]; curLot().edited = true; }
      redraw();
      return;
    }
    if (drag.pan) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
      drag.moved = true;
      canvas.style.cursor = 'grabbing';
      view.x = drag.vx - (e.clientX - drag.sx) / zoomScale();
      view.y = drag.vy - (e.clientY - drag.sy) / zoomScale();
      redraw();
      return;
    }
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
    drag.moved = true;
    canvas.style.cursor = 'grabbing';
    const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
    const ph = drag.ph;
    if (drag.hit.type === 'box') {
      const lay = ph.layout[drag.hit.id] = ph.layout[drag.hit.id] || {};
      lay.box = { x: (drag.box.x + dx) / ph.W, y: (drag.box.y + dy) / ph.H };
    } else if (drag.hit.type === 'dot') {
      const lay = ph.layout[drag.hit.id] = ph.layout[drag.hit.id] || {};
      lay.anchor = { x: (drag.anchor.x + dx) / ph.W, y: (drag.anchor.y + dy) / ph.H };
      if (!lay.box && drag.box) lay.box = { x: drag.box.x / ph.W, y: drag.box.y / ph.H };
    } else if (drag.hit.type === 'house' && drag.house) {
      ph.house = { x: (drag.house.x + dx) / ph.W, y: (drag.house.y + dy) / ph.H };
    }
    redraw();
  });
  const endDrag = (e) => {
    if (mode === 'mask' && maskEd && maskEd.drag) { maskUp(e); return; }
    if (drag && drag.lot != null) {
      if (drag.moved) { commit(); renderInspector(); }
      else select({ kind: 'lot', vertex: drag.lot }); // a plain click picks the corner
      drag = null;
      return;
    }
    if (drag && drag.pan) {
      if (!drag.moved) select(null);
      drag = null;
      canvas.style.cursor = view.z > 1 ? 'grab' : 'default';
      return;
    }
    // A dragged dot stays on this photo only. (It used to move the place's
    // map location for every photo, but drone readings are off by a
    // different amount in each shot, so a fix here was wrong elsewhere.)
    if (drag && drag.moved) { commit(); renderInspector(); }
    drag = null;
    canvas.style.cursor = 'default';
  };
  canvas.addEventListener('pointerup', endDrag);
  // Scroll (or pinch) to zoom around the mouse pointer.
  canvas.addEventListener('wheel', (e) => {
    const ph = photo();
    if (!ph) return;
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const speed = e.ctrlKey ? 0.01 : 0.0012; // pinch gestures send small numbers
    const z = Math.max(minZoom(), Math.min(MAX_ZOOM, view.z * Math.exp(-Math.max(-150, Math.min(150, dy)) * speed)));
    if (z === view.z) return;
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const pt = { x: mx / zoomScale() + view.x, y: my / zoomScale() + view.y };
    view.z = z;
    view.x = pt.x - mx / zoomScale();
    view.y = pt.y - my / zoomScale();
    redraw();
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    if (mode === 'drawLot') { finishLot(); return; }
    if (mode === 'mask') { if (maskEd && maskEd.tool === 'line') maskClosePoly(); return; }
    const hit = hitTest(toImage(e));
    if (hit && hit.type === 'lotVertex') {
      if (curLot().ring.length > 3) { curLot().ring.splice(hit.i, 1); curLot().edited = true; commit(); redraw(); renderInspector(); }
      return;
    }
    if (!hit) resetZoom();
  });

  // ---- Lot lines: find automatically, or draw by clicking the corners ----
  let drawPts = [];
  let lotBusy = false;
  async function autoFindLot(useLatLon) {
    const at = useLatLon || (S.house && { lat: S.house.lat, lon: S.house.lon });
    if (!at || lotBusy) { if (!at) setStatus('Find the address first, then lot lines can be looked up.', 'error'); return; }
    const ph = photo();
    if (!ph || !camFor(ph)) { setStatus('Lot lines need a drone photo. Pick one in the strip below.', 'error'); return; }
    lotBusy = true;
    setStatus('Looking up the lot lines…');
    try {
      const lot = await PL.findLot(at.lat, at.lon);
      if (!lot) {
        setStatus(`No lot lines found here. The automatic lookup covers ${PL.LOT_COVERAGE}. Use “Draw lot lines by hand”.`, 'error');
        return;
      }
      const old = ph.lot;
      ph.lot = { ...lot, lines: old ? old.lines !== false : true, pop: !!(old && old.pop), sky: old && old.sky };
      commit();
      if (photo() === ph) select({ kind: 'lot' });
      const ac = lot.acres || lotAcres();
      setStatus(`Lot lines found (${lot.source}${ac ? ', about ' + ac.toFixed(2) + ' acres' : ''}).${lot.nearby ? ' The address point was just off the lot, so the nearest lot was used: check it’s the right one.' : ''} Drag the corners to adjust.`, 'ok');
    } finally { lotBusy = false; }
  }
  function startDrawLot() {
    const ph = photo();
    if (!ph || !camFor(ph)) { setStatus(ph && ph.ground ? 'Lot lines need a drone photo. Pick a drone photo in the strip below, then draw.' : 'Add a photo with camera data first.', 'error'); return; }
    mode = 'drawLot';
    drawPts = [];
    const h = $('#modeHint');
    h.hidden = false;
    h.innerHTML = '<span>Click each corner of the lot. <b>Scroll out</b> to place corners past the edge of the photo. <b>Delete</b> removes the last corner. Double-click (or press Enter) on the last corner to finish.</span> <button class="btn small" id="cancelMode">Cancel</button>';
    $('#cancelMode').onclick = () => { drawPts = []; endMode(); redraw(); };
    canvas.style.cursor = 'crosshair';
    redraw();
  }
  function addLotPoint(pt) {
    const cam = camFor(photo());
    const ll = cam && PJ.unproject(cam, pt.x, pt.y);
    if (!ll) return;
    drawPts.push({ x: pt.x, y: pt.y, ll: [ll.lat, ll.lon] });
    redraw();
  }
  function finishLot() {
    // A double-click also adds its point twice; drop near-duplicates.
    const pts = drawPts.filter((p, i) => i === 0 || Math.hypot(p.x - drawPts[i - 1].x, p.y - drawPts[i - 1].y) > 4 / zoomScale());
    drawPts = [];
    endMode();
    if (pts.length < 3) { setStatus('A lot needs at least 3 corners. Try again.', 'error'); redraw(); return; }
    const ph = photo(), old = ph.lot;
    ph.lot = { ring: pts.map(p => p.ll), source: 'drawn by hand', acres: null, edited: true, lines: old ? old.lines !== false : true, pop: !!(old && old.pop), sky: old && old.sky };
    commit();
    select({ kind: 'lot' });
  }
  function deleteLotCorner(i) {
    if (!curLot() || !curLot().ring[i]) return;
    if (curLot().ring.length <= 3) { setStatus('A lot needs at least 3 corners. Use “Remove lot lines” to delete the whole outline.', 'error'); return; }
    curLot().ring.splice(i, 1);
    curLot().edited = true;
    commit();
    select({ kind: 'lot' });
  }
  // Delete (or bring back) the side from corner i to the next corner.
  function toggleLotSide(i) {
    const r = curLot() && curLot().ring[i];
    if (!r) return;
    if (r[2]) r.length = 2; else r[2] = 1;
    if (curLot().ring.every(c => c[2])) { r.length = 2; setStatus('At least one side has to stay. Use “Remove lot lines” to delete the whole outline.', 'error'); return; }
    curLot().edited = true;
    commit();
    select({ kind: 'lot', edge: i });
  }
  function lotAcres() {
    if (!curLot()) return null;
    const r = curLot().ring, lat0 = r[0][0], lon0 = r[0][1];
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = PJ.enu(lat0, lon0, r[i][0], r[i][1]), [x2, y2] = PJ.enu(lat0, lon0, r[(i + 1) % r.length][0], r[(i + 1) % r.length][1]);
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a / 2) / 4046.86;
  }
  $('#zoomFit').addEventListener('click', resetZoom);
  canvas.addEventListener('pointercancel', endDrag);

  function select(s) {
    sel = s;
    if (s && (s.kind === 'place' || s.kind === 'house' || s.kind === 'cat' || s.kind === 'lot')) tab = 'item';
    if (s && s.kind === 'place') {
      const p = S.places[s.id];
      const c = p && catById(p.cat);
      if (c) c.open = true;
    }
    redraw();
    renderSidebar();
    renderInspector();
    if (s && s.kind === 'place') {
      const li = document.querySelector(`#catList li[data-id="${CSS.escape(s.id)}"]`);
      li && li.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---------------- Custom callouts ----------------
  function startAddCustom() {
    if (!photo()) { setStatus('Add a photo first.', 'error'); return; }
    mode = 'addCustom';
    const h = $('#modeHint');
    h.hidden = false;
    h.innerHTML = 'Click the spot on the photo where the place is. <button class="btn small" id="cancelMode">Cancel</button>';
    $('#cancelMode').onclick = endMode;
  }
  // House pin: click the photo to put it where the house is (for when it's
  // off the edge of the photo or the camera angle puts it in the wrong spot).
  function startPlacePin() {
    if (!photo()) { setStatus('Add a photo first.', 'error'); return; }
    if (!S.house) { setStatus('Find the property address first.', 'error'); return; }
    mode = 'placePin';
    const h = $('#modeHint');
    h.hidden = false;
    h.innerHTML = 'Click the house on the photo to put the pin there. <button class="btn small" id="cancelMode">Cancel</button>';
    $('#cancelMode').onclick = () => { endMode(); redraw(); };
    redraw();
  }
  function placePinAt(pt) {
    const ph = photo();
    const cl = (v) => Math.min(1, Math.max(0, v));
    ph.house = { x: cl(pt.x / ph.W), y: cl(pt.y / ph.H) };
    ph.pin = true;
    endMode();
    sel = { kind: 'house' };
    commit(); renderAll();
    setStatus('House pin placed. Drag it to fine-tune.', 'ok');
  }
  $('#pinPlace').addEventListener('click', startPlacePin);
  function endMode() { const wasMask = mode === 'mask'; mode = null; maskEd = null; $('#modeHint').hidden = true; canvas.style.cursor = 'default'; if (wasMask) { renderInspector(); redraw(); } }

  // ---- Lot-line mask: what the lot lines pass behind (house, trees…) ----
  // Only while editing lot lines. Smart select's model is downloaded the
  // first time you pick that tool, never otherwise.
  let maskEd = null, spaceHeld = false;
  const MASK_TOOLS = [['smart', 'Smart select', 'S'], ['brush', 'Brush', 'B'], ['box', 'Box', 'R'], ['line', 'Straight lines', 'L']];
  function startMask() {
    const ph = photo();
    if (!ph || ph.ground || !curLot() || !scene || !scene.lot) { setStatus('Add lot lines to this drone photo first.', 'error'); return; }
    if (mode) endMode();
    mode = 'mask';
    maskEd = { name: ph.name, canvas: null, ver: 1, savedVer: 1, tool: 'brush', size: 24, show: true, poly: [], preview: null, scene, kind: 'on' };
    maskSync();
    renderMaskBar();
    renderInspector();
    redraw();
  }
  function maskSync() {
    const ph = photo();
    if (!maskEd || !ph || ph.name !== maskEd.name) { endMode(); return; }
    const c = DT.mask.blank(ph.W, ph.H);
    const src = ph.lotMask && DT.mask.fromData(ph.lotMask, () => { if (maskEd) { maskSync(); redraw(); } });
    if (src) c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    maskEd.canvas = c;
    maskEd.tint = DT.mask.tint2(c); // updated stroke by stroke from here on
    maskEd.k = c.width / ph.W;
    maskEd.ver++; maskEd.savedVer = maskEd.ver;
    maskEd.preview = null;
  }
  function renderMaskBar() {
    const h = $('#modeHint');
    h.hidden = false;
    const tip = { smart: 'Hover over the house, a tree or a pool, then click to add it.', brush: 'Paint over what the lines should pass behind.', box: 'Drag a box.', line: 'Click corners; double-click or Enter to close the shape.' }[maskEd.tool]
      + ' <b>Red</b> = on the property (stays in color), <b>blue</b> = off the property (goes gray with a color callout).';
    h.innerHTML = `<div class="mask-bar">
      <div class="seg">${MASK_TOOLS.map(([id, label, key]) => `<button data-mtool="${id}" class="${maskEd.tool === id ? 'active' : ''}" title="${label} (${key})">${label}</button>`).join('')}</div>
      <div class="seg kind" title="X switches">
        <button data-mkind="on" class="${maskEd.kind === 'on' ? 'active' : ''}" title="Stays in color with a color callout (X)">On the property</button>
        <button data-mkind="off" class="${maskEd.kind === 'off' ? 'active off' : ''}" title="Goes gray with a color callout (X)">Off the property</button>
      </div>
      ${maskEd.tool === 'brush' ? `<label class="mask-size">Size <input type="range" id="maskSize" min="4" max="160" value="${maskEd.size}"></label>` : ''}
      <label class="check mask-show"><input type="checkbox" id="maskShow" ${maskEd.show ? 'checked' : ''}> Show mask</label>
      <button class="btn small primary" id="maskDone">Done</button>
      <div class="mask-tip">${tip} <b>Shift</b> adds, <b>Alt</b> removes. Hold <b>Space</b> and drag to move around; scroll to zoom.${maskEd.status ? ' <i>' + esc(maskEd.status) + '</i>' : ''}</div>
    </div>`;
  }
  $('#modeHint').addEventListener('click', (e) => {
    if (!maskEd) return;
    const t = e.target.closest('[data-mtool]');
    if (t) { setMaskTool(t.dataset.mtool); return; }
    const kd = e.target.closest('[data-mkind]');
    if (kd) { maskEd.kind = kd.dataset.mkind; renderMaskBar(); redraw(); return; }
    if (e.target.closest('#maskDone')) endMode();
  });
  $('#modeHint').addEventListener('input', (e) => {
    if (!maskEd) return;
    if (e.target.id === 'maskSize') { maskEd.size = +e.target.value; redraw(); }
    if (e.target.id === 'maskShow') { maskEd.show = e.target.checked; redraw(); }
  });
  function setMaskTool(t) {
    if (!maskEd) return;
    maskEd.tool = t; maskEd.poly = []; maskEd.preview = null; maskEd.drag = null;
    if (t === 'smart') prepareSmart();
    renderMaskBar(); redraw();
  }
  function maskStatus(msg) { if (!maskEd) return; maskEd.status = msg; renderMaskBar(); }
  const smartKey = () => (S.jobId || 'job') + '|' + maskEd.name;
  function prepareSmart() {
    const a = assets.get(maskEd.name);
    if (!a) return;
    const me = maskEd;
    DT.mask.prepare(smartKey(), a.bitmap, (m) => { if (maskEd === me) maskStatus(m); })
      .then(() => { if (maskEd === me) maskStatus('Smart select ready.'); })
      .catch((e) => { console.error(e); if (maskEd === me) { maskStatus('Smart select couldn’t load (' + e.message + '). Use the brush, box or line tools.'); } });
  }
  const maskOp = (e) => e.altKey ? 'remove' : 'add';
  const capture = (e) => { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not a real pointer */ } };
  // Paint on the mask (white = on the property, blue = off) and on its
  // see-through preview in the matching color.
  function paint(op, fn) {
    const off = maskEd.kind === 'off';
    for (const [cv, color] of [[maskEd.canvas, off ? DT.mask.OFF : DT.mask.ON], [maskEd.tint, DT.mask.TINT[off ? 'off' : 'on']]]) {
      const x = cv.getContext('2d');
      x.save();
      if (op === 'remove') x.globalCompositeOperation = 'destination-out';
      else {
        // Replace whatever was there (so on ↔ off can be repainted).
        const tmp = document.createElement('canvas');
        tmp.width = cv.width; tmp.height = cv.height;
        const t = tmp.getContext('2d');
        t.fillStyle = t.strokeStyle = '#000';
        t.scale(maskEd.k, maskEd.k);
        fn(t, true);
        x.globalCompositeOperation = 'destination-out';
        x.drawImage(tmp, 0, 0);
        x.globalCompositeOperation = 'source-over';
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = color;
        t.fillRect(0, 0, tmp.width, tmp.height);
        x.drawImage(tmp, 0, 0);
        x.restore();
        continue;
      }
      x.fillStyle = x.strokeStyle = '#fff';
      x.scale(maskEd.k, maskEd.k);
      fn(x);
      x.restore();
    }
    maskEd.ver++;
  }
  function maskSave() {
    const ph = photo();
    if (!maskEd || !ph || ph.name !== maskEd.name) return;
    if (DT.mask.isEmpty(maskEd.canvas)) delete ph.lotMask;
    else { ph.lotMask = maskEd.canvas.toDataURL('image/png'); DT.mask.remember(ph.lotMask, maskEd.canvas); }
    maskEd.savedVer = maskEd.ver;
    commit();
    renderInspector();
    redraw();
  }
  function maskDown(e, pt) {
    if (!maskEd) return;
    const op = maskOp(e);
    const t = maskEd.tool;
    if (t === 'brush') {
      const r = maskEd.size / zoomScale() / 2;
      paint(op, (x) => { x.beginPath(); x.arc(pt.x, pt.y, r, 0, Math.PI * 2); x.fill(); });
      maskEd.drag = { tool: 'brush', op, last: pt, r };
      capture(e);
    } else if (t === 'box') {
      maskEd.drag = { tool: 'box', op, a: pt, b: pt };
      capture(e);
    } else if (t === 'line') {
      if (!maskEd.poly.length) maskEd.polyOp = op;
      const first = maskEd.poly[0];
      if (first && maskEd.poly.length > 2 && Math.hypot(pt.x - first.x, pt.y - first.y) < 10 / zoomScale()) { maskClosePoly(); return; }
      maskEd.poly.push(pt);
    } else if (t === 'smart') {
      applySmart(pt, op);
      return;
    }
    redraw();
  }
  function maskMove(e, pt) {
    if (!maskEd) return;
    maskEd.cursor = pt;
    maskEd.alt = e.altKey;
    const d = maskEd.drag;
    if (d && d.tool === 'brush') {
      paint(d.op, (x) => { x.lineWidth = d.r * 2; x.lineCap = 'round'; x.beginPath(); x.moveTo(d.last.x, d.last.y); x.lineTo(pt.x, pt.y); x.stroke(); });
      d.last = pt;
    } else if (d && d.tool === 'box') d.b = pt;
    if (maskEd.tool === 'smart' && !d) hoverSmart(pt, e);
    canvas.style.cursor = maskEd.tool === 'brush' ? 'none' : 'crosshair';
    redraw();
  }
  function maskUp() {
    const d = maskEd && maskEd.drag;
    if (!d) return;
    maskEd.drag = null;
    if (d.tool === 'box') {
      const x0 = Math.min(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), w = Math.abs(d.b.x - d.a.x), h = Math.abs(d.b.y - d.a.y);
      if (w > 1 && h > 1) paint(d.op, (x) => x.fillRect(x0, y0, w, h));
    }
    maskSave();
  }
  function maskClosePoly() {
    if (!maskEd) return;
    const pts = maskEd.poly.filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 2 / zoomScale());
    maskEd.poly = [];
    if (pts.length >= 3) {
      paint(maskEd.polyOp || 'add', (x) => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)); x.closePath(); x.fill(); });
      maskSave();
    } else redraw();
  }
  // Smart select: guess the object under the mouse once it rests briefly.
  let smartTimer = null, smartBusy = false, smartId = 0;
  function hoverSmart(pt, e) {
    clearTimeout(smartTimer);
    const ph = photo();
    if (maskEd.preview && Math.hypot(pt.x - maskEd.preview.pt.x, pt.y - maskEd.preview.pt.y) > 12 / zoomScale()) maskEd.preview = null;
    if (maskEd.preview) { maskEd.preview.op = maskOp(e); return; }
    if (pt.x < 0 || pt.y < 0 || pt.x > ph.W || pt.y > ph.H) return;
    const op = maskOp(e);
    smartTimer = setTimeout(() => runSmart(pt, op).catch(() => {}), 110);
  }
  async function runSmart(pt, op) {
    if (!maskEd || smartBusy) return null;
    const a = assets.get(maskEd.name), ph = photo();
    if (!a || !ph) return null;
    smartBusy = true;
    const me = maskEd;
    try {
      const c = await DT.mask.segment(smartKey(), a.bitmap, pt.x / ph.W, pt.y / ph.H);
      if (maskEd !== me) return null;
      if (me.status && /Studying|Downloading/.test(me.status)) maskStatus('Smart select ready.');
      me.preview = { pt, canvas: c, op, id: ++smartId };
      redraw();
      return me.preview;
    } catch (e) {
      console.error(e);
      if (maskEd === me) maskStatus('Smart select couldn’t load (' + e.message + '). Use the brush, box or line tools.');
      return null;
    } finally { smartBusy = false; }
  }
  async function applySmart(pt, op) {
    let p = maskEd.preview;
    if (!p || Math.hypot(pt.x - p.pt.x, pt.y - p.pt.y) > 12 / zoomScale()) p = await runSmart(pt, op);
    if (!p || !maskEd) return;
    const ph = photo();
    paint(op, (x) => { x.imageSmoothingEnabled = true; x.drawImage(p.canvas, 0, 0, ph.W, ph.H); });
    maskEd.preview = null;
    maskSave();
  }
  // Screen-only extras while masking: brush ring, box and shape in progress.
  function drawMaskOverlay() {
    const z = zoomScale(), m = maskEd, c = m.cursor;
    ctx.save();
    ctx.lineWidth = 1.5 / z;
    const col = (op) => op === 'remove' ? '#facc15' : '#38bdf8';
    if (m.tool === 'brush' && c) {
      ctx.strokeStyle = col(m.drag ? m.drag.op : (m.alt ? 'remove' : 'add'));
      ctx.beginPath(); ctx.arc(c.x, c.y, m.size / z / 2, 0, Math.PI * 2); ctx.stroke();
    }
    if (m.drag && m.drag.tool === 'box') {
      const d = m.drag;
      ctx.strokeStyle = col(d.op); ctx.setLineDash([5 / z, 4 / z]);
      ctx.strokeRect(Math.min(d.a.x, d.b.x), Math.min(d.a.y, d.b.y), Math.abs(d.b.x - d.a.x), Math.abs(d.b.y - d.a.y));
    }
    if (m.tool === 'line' && m.poly.length) {
      ctx.strokeStyle = col(m.polyOp); ctx.setLineDash([5 / z, 4 / z]);
      ctx.beginPath(); m.poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      if (c) ctx.lineTo(c.x, c.y);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      for (const p of m.poly) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 / z, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
  }
  function addCustomAt(pt) {
    endMode();
    const ph = photo();
    const cam = camFor(ph);
    const ll = cam ? PJ.unproject(cam, pt.x, pt.y) : null;
    const id = 'custom:' + Date.now().toString(36);
    const p = { id, source: 'custom', cat: 'custom', name: 'New place', title: 'New place', enabled: true };
    if (ll) {
      p.lat = ll.lat; p.lon = ll.lon;
      p.distMi = S.house ? PJ.distM(S.house.lat, S.house.lon, ll.lat, ll.lon) / MI : 0;
      p.id = 'mine:' + Date.now().toString(36);
      p.source = 'mine';
      p.route = { lat: ll.lat, lon: ll.lon };
    } else {
      p.photoOnly = ph.name;
      p.distMi = 0;
      ph.layout[id] = { anchor: { x: pt.x / ph.W, y: pt.y / ph.H } };
    }
    S.places[p.id] = p;
    if (!ll) {} // stays in this job only (no camera to place it on the map)
    const c = catById('custom');
    if (c) { c.enabled = true; c.open = true; }
    commit();
    select({ kind: 'place', id: p.id });
    const t = $('#inspector [data-path="place.title"]');
    if (t) { t.focus(); t.select(); }
  }

  // ---------------- Sidebar ----------------
  function iconHtml(key, bg) {
    if (key && key.startsWith('logo:')) {
      const l = logos.find(x => x.id === key.slice(5));
      if (l) return `<span class="ico ${l.mode === 'badge' ? 'badge' : ''}" style="background:${l.mode === 'badge' ? '#fff' : bg}"><img src="${l.mode === 'badge' ? l.badge : l.glyph}" alt=""></span>`;
      key = 'star';
    }
    return `<span class="ico" style="background:${bg}">${IC.svg(key)}</span>`;
  }

  function fmtMi(mi) { return mi == null ? '' : (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi'; }

  // Sidebar view: "Whole job" lists everything you can tag in any photo;
  // "This photo" refines just the photo on screen.
  let sideView = 'job';
  try { sideView = localStorage.getItem('dronetag-ui:sideView') || 'job'; } catch (e) { /* private window */ }
  function setSideView(v) {
    sideView = v;
    try { localStorage.setItem('dronetag-ui:sideView', v); } catch (e) { /* ignore */ }
    renderSidebar();
  }
  $('#viewToggle').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) setSideView(b.dataset.view); });

  function jobIndex() {
    const cams = S.photos.map(ph => camFor(ph));
    const listed = {}, beyond = {}, nearby = {}, photosOf = {};
    for (const { p, cat } of eligiblePlaces()) {
      const ins = [];
      S.photos.forEach((ph, i) => { if (anchorOn(p, ph, cams[i])) ins.push(i); });
      photosOf[p.id] = ins;
      const within = inRange(p, cat);
      const bucket = !S.photos.length ? (within ? listed : null) : ins.length ? (within ? listed : beyond) : (within ? nearby : null);
      if (bucket) (bucket[cat.id] = bucket[cat.id] || []).push(p);
    }
    return { listed, beyond, nearby, photosOf };
  }

  const num2 = (i) => String(i + 1).padStart(2, '0');
  function renderSidebar() {
    const list = $('#catList');
    const ph = photo();
    const job = sideView === 'job' || !ph;
    document.querySelectorAll('#viewToggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === (job ? 'job' : 'photo'));
      if (b.dataset.view === 'photo') { b.disabled = !ph; b.textContent = ph ? `Photo ${num2(cur)}` : 'This photo'; }
    });
    $('#viewHint').innerHTML = job
      ? (S.photos.length ? `Everything you can tag across all ${S.photos.length} photo${S.photos.length === 1 ? '' : 's'}. Untick what you don’t want anywhere, then open a photo to fine-tune.` : 'Everything nearby. Add photos to see which ones each place shows up in.')
      : `Changes here affect <b>photo ${num2(cur)} only</b>. Switch to <b>Whole job</b> to turn places on or off everywhere.`;
    const idx = job ? jobIndex() : null;
    const listed = job ? idx.listed : scene ? scene.listed : {};
    const beyond = job ? idx.beyond : scene ? scene.beyond : {};
    const nearby = job ? idx.nearby : {};
    const hasPlaces = Object.keys(S.places).length > 0;
    const isOn = (p) => job ? p.enabled !== false : shownOn(p, ph);
    list.innerHTML = S.categories.filter(c => c.used !== false).map(cat => {
      const items = (listed[cat.id] || []).slice().sort((a, b) => (a.distMi ?? 0) - (b.distMi ?? 0));
      const far = (beyond[cat.id] || []).slice().sort((a, b) => a.distMi - b.distMi);
      const near = (nearby[cat.id] || []).slice().sort((a, b) => a.distMi - b.distMi);
      const on = items.filter(isOn).length;
      const isSel = sel && sel.kind === 'cat' && sel.id === cat.id;
      const rows = items.map(p => {
        const selCls = sel && sel.kind === 'place' && sel.id === p.id ? 'sel' : '';
        const drive = p.drive && wantsDrive(p) ? ` · ${Math.round(p.drive.min)} min` : '';
        let note = '', chips = '';
        if (job) {
          const ins = idx.photosOf[p.id] || [];
          const changed = ins.filter(i => S.photos[i].hidden[p.id] !== undefined).length;
          if (changed) note = ` · changed on ${changed}`;
          if (ins.length) chips = `<div class="ph-chips">${ins.length > 12 ? `<span class="muted-n">in ${ins.length} photos</span>` : ins.map(i =>
            `<button class="ph-chip ${shownOn(p, S.photos[i]) ? '' : 'off'} ${i === cur ? 'cur' : ''}" data-act="goto-photo" data-i="${i}" title="Open photo ${num2(i)}${shownOn(p, S.photos[i]) ? '' : ' (hidden there)'}">${num2(i)}</button>`).join('')}</div>`;
        } else if (ph.hidden[p.id] !== undefined) {
          note = ph.hidden[p.id] ? ' · hidden here' : ' · shown here only';
        }
        return `<li data-id="${esc(p.id)}" class="${selCls} ${isOn(p) ? '' : 'off'}">
          <input type="checkbox" data-act="place-toggle" ${isOn(p) ? 'checked' : ''} title="${job ? 'Show on all photos' : 'Show on this photo'}">
          <button class="ico-btn" data-act="place-icon" title="Change icon">${iconHtml(p.icon || p.kindIcon || cat.icon, p.iconColor || cat.color)}</button>
          <input class="title" data-act="place-title" value="${esc(p.title ?? p.name)}" title="Edit the callout text">
          <span class="dist">${p.source === 'custom' ? '' : fmtMi(p.distMi)}${drive}${note}</span>
          <button class="more" data-act="place-edit" title="More options">⋯</button>
          ${chips}
        </li>`;
      }).join('');
      const farRows = far.length ? `<details class="far"><summary>${far.length} more in ${job ? 'your photos' : 'the photo'} but farther than ${cat.maxMi} mi</summary><ul>${
        far.map(p => `<li data-id="${esc(p.id)}"><button class="btn small" data-act="place-always">Show</button><span class="title-ro">${esc(p.title ?? p.name)}</span><span class="dist">${fmtMi(p.distMi)}</span></li>`).join('')
      }</ul></details>` : '';
      const nearRows = near.length ? `<details class="far"><summary>${near.length} within ${cat.maxMi} mi but not in any photo</summary><ul>${
        near.map(p => `<li><span class="title-ro">${esc(p.title ?? p.name)}</span><span class="dist">${fmtMi(p.distMi)}</span></li>`).join('')
      }</ul></details>` : '';
      const empty = !items.length ? `<li class="none">${hasPlaces || cat.id === 'custom' ? (cat.id === 'custom' ? 'Use “Add a callout” below.' : job ? 'Nothing within range in any photo.' : 'Nothing in this photo within range.') : 'Click Find places to search.'}</li>` : '';
      return `<div class="cat ${cat.open ? 'open' : ''} ${cat.enabled ? '' : 'disabled'} ${isSel ? 'sel' : ''}" data-cat="${esc(cat.id)}">
        <div class="cat-head">
          <span class="grip" draggable="true" title="Drag to reorder">⋮⋮</span>
          <input type="checkbox" data-act="cat-toggle" ${cat.enabled ? 'checked' : ''} title="Show this whole category">
          <button class="ico-btn" data-act="cat-edit" title="Category settings">${iconHtml(cat.icon, cat.color)}</button>
          <button class="cat-name" data-act="cat-open">${esc(cat.name)}</button>
          <span class="count" title="Shown / available">${cat.enabled ? on : 0}/${items.length}</span>
          <button class="chev" data-act="cat-open" aria-label="Expand">▾</button>
        </div>
        <div class="cat-body">
          ${cat.id === 'custom' ? '' : `<div class="row slider-row"><span>Within</span><input type="range" data-act="cat-dist" min="0.25" max="${cat.rangeMax || 15}" step="${(cat.rangeMax || 15) > 15 ? 1 : 0.25}" value="${cat.maxMi}"><output>${cat.maxMi} mi</output></div>`}
          ${cat.id === 'shopping' ? `<label class="check small"><input type="checkbox" data-act="cat-major" ${cat.majorOnly ? 'checked' : ''}> Major stores only (big brands like Target, Costco)</label>` : ''}
          <ul>${rows}${empty}</ul>
          ${farRows}${nearRows}
        </div>
      </div>`;
    }).join('');
  }

  // ---- Find a place (bottom of the list) ----
  // Searches the places this property already has; "Search the map" looks
  // further (anything on OpenStreetMap near the property).
  const normQ = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  let mapHits = null, mapQ = '', mapBusy = false;
  function placeStatus(p, cat, idx) {
    if (cat.used === false) return 'type turned off';
    const ins = idx.photosOf[p.id] || [];
    const on = cat.enabled && p.enabled !== false;
    if (!S.photos.length) return on ? 'on' : 'off';
    if (!ins.length) return 'not in any photo';
    if (!inRange(p, cat)) return `in ${ins.length} photo${ins.length > 1 ? 's' : ''}, past ${cat.maxMi} mi`;
    return on ? `on · ${ins.length} photo${ins.length > 1 ? 's' : ''}` : `off · in ${ins.length} photo${ins.length > 1 ? 's' : ''}`;
  }
  function renderSearch() {
    const box = $('#searchResults');
    const q = normQ($('#placeSearch').value);
    if (!q) { box.innerHTML = ''; mapHits = null; return; }
    const words = q.split(' ');
    const idx = jobIndex();
    // Every place this property has, even in types that are off.
    const hits = [];
    for (const p of Object.values(S.places)) {
      const cat = catById(p.cat);
      if (!cat) continue;
      const n = normQ((p.title ?? p.name) + ' ' + (p.title != null ? p.name : ''));
      if (!words.every(w => n.includes(w))) continue;
      const starts = n.startsWith(q) ? 0 : 1;
      hits.push({ p, cat, rank: starts * 1000 + (p.distMi ?? 0) });
    }
    hits.sort((a, b) => a.rank - b.rank);
    const local = hits.slice(0, 8).map(({ p, cat }) => {
      const st = placeStatus(p, cat, idx);
      return `<button class="sr" data-sr-place="${esc(p.id)}" title="Show it in the list and turn it on">
        ${iconHtml(p.icon || p.kindIcon || cat.icon, p.iconColor || cat.color)}
        <span class="sr-name">${esc(p.title ?? p.name)}<small>${esc(cat.name)}${p.distMi != null && p.source !== 'custom' ? ' · ' + fmtMi(p.distMi) : ''} · ${esc(st)}</small></span></button>`;
    }).join('');
    const showMap = mapHits && mapQ === q;
    const mapRows = showMap ? (mapHits.length ? mapHits.map((h, i) => `<button class="sr" data-sr-map="${i}" title="${esc(h.label)}">
        <span class="ico" style="background:#64748b">${IC.svg('star')}</span>
        <span class="sr-name">${esc(h.name)}<small>${esc([h.kind, h.where, S.house ? fmtMi(h.d / MI) : ''].filter(Boolean).join(' · '))}</small></span><span class="sr-add">Add</span></button>`).join('')
      : '<p class="hint">Nothing on the map by that name nearby.</p>') : '';
    box.innerHTML = (local || (!showMap ? `<p class="hint">Not in this property’s places${Object.keys(S.places).length ? '' : ' (click Find places first)'}.</p>` : ''))
      + (showMap ? `<p class="lbl sr-head">On the map</p>${mapRows}` : `<button class="btn small block" id="srMap" ${mapBusy ? 'disabled' : ''}>${mapBusy ? 'Searching…' : `Search the map for “${esc($('#placeSearch').value.trim())}”`}</button>`);
  }
  async function searchMap() {
    const raw = $('#placeSearch').value.trim();
    if (!raw || mapBusy) return;
    mapBusy = true; renderSearch();
    try {
      const near = S.house || (() => { const c = S.photos.map(x => camFor(x)).find(Boolean); return c && { lat: c.lat, lon: c.lon }; })();
      mapHits = await SV.searchPlaces(raw, near);
      mapQ = normQ(raw);
    } catch (e) {
      console.error(e);
      setStatus('Map search failed: ' + e.message, 'error');
    } finally { mapBusy = false; renderSearch(); }
  }
  // Turn a place on and show it in the list.
  function revealPlace(p) {
    const cat = catById(p.cat);
    if (!cat) return;
    if (cat.used === false) cat.used = true; // this property only
    cat.enabled = true; cat.open = true;
    p.enabled = true;
    if (!inRange(p, cat)) p.always = true;
    const ph = photo();
    if (sideView === 'photo' && ph && !shownOn(p, ph)) setShownOn(p, ph, true);
    commit();
    select({ kind: 'place', id: p.id });
    renderAll();
    const ins = jobIndex().photosOf[p.id] || [];
    if (S.photos.length && !ins.length) setStatus(`“${p.title ?? p.name}” is turned on, but it isn’t in view in any of these photos.`, 'error');
    else setStatus(`“${p.title ?? p.name}” is on${S.photos.length ? ` (in ${ins.length} photo${ins.length > 1 ? 's' : ''})` : ''}.`, 'ok');
    const li = document.querySelector(`#catList li[data-id="${CSS.escape(p.id)}"]`);
    if (li) { li.scrollIntoView({ block: 'center', behavior: 'smooth' }); li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 1600); }
  }
  // Add a place found on the map as one of My callouts.
  function addMapHit(h) {
    const near = Object.values(S.places).find(p => p.lat != null && normQ(p.title ?? p.name) === normQ(h.name) && PJ.distM(p.lat, p.lon, h.lat, h.lon) < 300);
    if (near) { revealPlace(near); return; }
    const p = { id: 'mine:' + Date.now().toString(36), source: 'mine', cat: 'custom', name: h.name, title: h.name, enabled: true,
      lat: h.lat, lon: h.lon, route: { lat: h.lat, lon: h.lon }, distMi: S.house ? PJ.distM(S.house.lat, S.house.lon, h.lat, h.lon) / MI : 0 };
    S.places[p.id] = p;
    revealPlace(p);
    maybeFetchDrive();
    renderSearch();
  }
  let searchT = null;
  $('#placeSearch').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(renderSearch, 120); });
  $('#placeSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = $('#searchResults .sr');
      if (first) first.click(); else searchMap();
    }
    if (e.key === 'Escape') { e.target.value = ''; renderSearch(); }
  });
  $('#searchResults').addEventListener('click', (e) => {
    if (e.target.closest('#srMap')) { searchMap(); return; }
    const a = e.target.closest('[data-sr-place]');
    if (a) { const p = S.places[a.dataset.srPlace]; if (p) revealPlace(p); renderSearch(); return; }
    const m = e.target.closest('[data-sr-map]');
    if (m && mapHits) addMapHit(mapHits[+m.dataset.srMap]);
  });

  // ---- Reordering categories (drag the ⋮⋮ handle) ----
  let catOrder = [];
  function applyCatOrder() {
    if (!catOrder.length) return;
    const pos = (id) => { const k = catOrder.indexOf(id); return k < 0 ? 1e6 : k; };
    S.categories = S.categories.map((c, i) => [c, i]).sort((a, b) => pos(a[0].id) - pos(b[0].id) || a[1] - b[1]).map(x => x[0]);
  }
  function moveCat(id, targetId, after) {
    const c = catById(id);
    if (!c || id === targetId) return;
    S.categories.splice(S.categories.indexOf(c), 1);
    let at = S.categories.findIndex(x => x.id === targetId);
    if (after) at++;
    S.categories.splice(at, 0, c);
    catOrder = S.categories.map(x => x.id);
    SV.store.save('catOrder', catOrder);
    commit();
    renderAll();
  }
  let dragCat = null;
  const clearDrop = () => document.querySelectorAll('.cat.drop-before, .cat.drop-after, .cat.dragging').forEach(el => el.classList.remove('drop-before', 'drop-after', 'dragging'));
  $('#catList').addEventListener('dragstart', (e) => {
    const g = e.target.closest && e.target.closest('.grip');
    if (!g) return;
    const el = g.closest('.cat');
    dragCat = el.dataset.cat;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragCat);
    e.dataTransfer.setDragImage(el.querySelector('.cat-head'), 12, 14);
    el.classList.add('dragging');
  });
  $('#catList').addEventListener('dragover', (e) => {
    if (!dragCat) return;
    const el = e.target.closest('.cat');
    if (!el) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = e.clientY > r.top + Math.min(r.height, 40) / 2;
    document.querySelectorAll('.cat.drop-before, .cat.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    if (el.dataset.cat !== dragCat) el.classList.add(after ? 'drop-after' : 'drop-before');
  });
  $('#catList').addEventListener('drop', (e) => {
    if (!dragCat) return;
    e.preventDefault();
    const el = e.target.closest('.cat');
    const after = el && el.classList.contains('drop-after');
    const id = dragCat;
    dragCat = null;
    clearDrop();
    if (el) moveCat(id, el.dataset.cat, after);
  });
  $('#catList').addEventListener('dragend', () => { dragCat = null; clearDrop(); });

  const catList = $('#catList');
  catList.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const catEl = t.closest('.cat');
    const cat = catEl && catById(catEl.dataset.cat);
    const li = t.closest('li[data-id]');
    const p = li && S.places[li.dataset.id];
    switch (t.dataset.act) {
      case 'cat-open': cat.open = !cat.open; catEl.classList.toggle('open', cat.open); break;
      case 'cat-edit': select({ kind: 'cat', id: cat.id }); break;
      case 'place-icon':
        openIconPicker(p.icon || p.kindIcon || cat.icon, (key) => { p.icon = key; rememberIcon(p, key); commit(); renderAll(); }, pickCtx(p));
        break;
      case 'place-edit': select({ kind: 'place', id: p.id }); break;
      case 'place-always': p.always = true; p.enabled = true; commit(); renderAll(); break;
      case 'goto-photo':
        cur = +t.dataset.i;
        sel = { kind: 'place', id: p.id };
        setSideView('photo');
        renderAll();
        break;
    }
  });
  catList.addEventListener('change', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const catEl = t.closest('.cat');
    const cat = catEl && catById(catEl.dataset.cat);
    const li = t.closest('li[data-id]');
    const p = li && S.places[li.dataset.id];
    switch (t.dataset.act) {
      case 'cat-toggle': cat.enabled = t.checked; if (cat.enabled) { cat.open = true; maybeRefetch(); } break;
      case 'cat-major': cat.majorOnly = t.checked; break;
      case 'cat-dist': cat.maxMi = parseFloat(t.value); maybeRefetch(); break;
      case 'place-toggle':
        if (sideView === 'photo' && photo()) setShownOn(p, photo(), t.checked); else p.enabled = t.checked;
        break;
      case 'place-title': p.title = t.value; break;
      default: return;
    }
    commit();
    renderAll();
  });
  catList.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.act === 'cat-dist') {
      const cat = catById(t.closest('.cat').dataset.cat);
      cat.maxMi = parseFloat(t.value);
      t.nextElementSibling.textContent = cat.maxMi + ' mi';
      redraw();
    }
  });
  catList.addEventListener('focusin', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li && e.target.dataset.act === 'place-title') {
      sel = { kind: 'place', id: li.dataset.id };
      redraw();
      renderInspector();
    }
  });

  // ---------------- Inspector (right panel) ----------------
  const roots = {
    style: () => S.style,
    place: () => sel && sel.kind === 'place' ? S.places[sel.id] : null,
    cat: () => sel && sel.kind === 'cat' ? catById(sel.id) : null,
    adj: () => photo() && photo().adj,
    lot: () => curLot(),
    photo: () => photo(),
  };
  function getPath(path) {
    const [root, key] = path.split('.');
    const o = roots[root]();
    return o ? o[key] : undefined;
  }
  function setPath(path, v) {
    const [root, key] = path.split('.');
    const o = roots[root]();
    if (!o) return;
    if (v === null || v === '') delete o[key]; else o[key] = v;
  }

  // Altitude slider position (0–1000) <-> feet. Squared so the first part
  // of the slider moves in small steps and the far end covers big heights.
  const ALT_MIN = 3, ALT_MAX = 3000;
  const altFt = (pos) => Math.round(ALT_MIN + (ALT_MAX - ALT_MIN) * (pos / 1000) ** 2);
  const altPos = (ft) => Math.round(1000 * Math.sqrt(Math.min(1, Math.max(0, (ft - ALT_MIN) / (ALT_MAX - ALT_MIN)))));

  const ui = {
    range(label, path, min, max, step, opts = {}) {
      const k = opts.scale || 1;
      let v = getPath(path);
      if (v == null) v = opts.fallback ?? min * k;
      const shown = v / k;
      const fmt = opts.fmt || ((x) => (+x).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0));
      return `<div class="field"><div class="row between"><label>${label}</label><output>${fmt(shown)}${opts.unit || ''}</output></div>
        <input type="range" data-path="${path}" data-type="num" data-scale="${k}" data-unit="${opts.unit || ''}" data-dec="${step < 1 ? (step < 0.1 ? 2 : 1) : 0}" min="${min}" max="${max}" step="${step}" value="${shown}"></div>`;
    },
    // Drone altitude: a slider that's finer at low heights (3 ft to 3,000 ft),
    // a number box for an exact value, the photo's own reading and a button
    // to go back to it.
    altitude(path, reading, fallback) {
      const v = getPath(path) ?? reading ?? fallback;
      const ft = Math.round(v / FT);
      const pos = altPos(ft);
      const changed = reading != null && Math.abs(ft - Math.round(reading / FT)) >= 1;
      return `<div class="field alt-field"><div class="row between"><label>Altitude (height above the house)</label>
          <span class="row"><input type="number" class="alt-num" data-path="${path}" data-type="num" data-scale="${FT}" min="${ALT_MIN}" max="10000" step="1" value="${ft}"> ft</span></div>
        <input type="range" class="alt-range" data-path="${path}" data-type="alt" min="0" max="1000" step="1" value="${pos}">
        <div class="row between alt-reading"><span class="hint">${reading != null ? `Photo says: <b>${Math.round(reading / FT)} ft</b>${changed ? ' (you changed it)' : ''}` : 'This photo has no altitude reading.'}</span>
          ${reading != null ? `<button class="btn small subtle" data-act="alt-photo" data-path="${path}" ${changed ? '' : 'disabled'}>Use photo’s reading</button>` : ''}</div></div>`;
    },
    color(label, path, fallback, resettable) {
      const v = getPath(path) || fallback;
      return `<div class="field row between"><label>${label}</label><span class="row">
        ${resettable && getPath(path) ? `<button class="btn small subtle" data-act="reset" data-path="${path}">Reset</button>` : ''}
        <input type="color" data-path="${path}" data-type="str" value="${esc(v)}"></span></div>`;
    },
    select(label, path, options) {
      const v = getPath(path);
      return `<div class="field"><label>${label}</label><select data-path="${path}" data-type="${typeof options[0][0] === 'number' ? 'num' : 'str'}">${
        options.map(([val, text]) => `<option value="${esc(val)}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
    },
    check(label, path) {
      return `<label class="check field"><input type="checkbox" data-path="${path}" data-type="bool" ${getPath(path) ? 'checked' : ''}> ${label}</label>`;
    },
    text(label, path, placeholder) {
      return `<div class="field"><label>${label}</label><input type="text" data-path="${path}" data-type="str" value="${esc(getPath(path) ?? placeholder ?? '')}" placeholder="${esc(placeholder || '')}"></div>`;
    },
  };

  function setTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    renderInspector();
  }
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

  function renderInspector() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const el = $('#inspector');
    if (tab === 'style') el.innerHTML = styleTab();
    else if (tab === 'camera') el.innerHTML = cameraTab();
    else if (tab === 'presets') { el.innerHTML = presetsTab(); renderPresetList(); }
    else el.innerHTML = itemTab();
  }

  function itemTab() {
    if (!sel) {
      return `<div class="hint-card"><h3>Editing</h3><p>Click a callout on the photo, or <b>⋯</b> next to a place in the list, to change its text, icon and colors.</p>
        <ul class="tips"><li>Drag a <b>box</b> to move it.</li><li>Drag the <b>dot</b> to move where the line points.</li><li>Drag the <b>house pin</b> to move it.</li><li><b>Scroll</b> to zoom in and out; drag an empty spot to move around; double-click to fit.</li><li><b>⌘Z</b> undo · <b>⇧⌘Z</b> redo · <b>Delete</b> hides the selected callout (on this photo in “This photo” view, everywhere in “Whole job” view).</li></ul></div>
        ${photo() ? `<div class="btn-col">
          <button class="btn block" data-act="house-place">Place the house pin by clicking the photo</button>
          <button class="btn block subtle" data-act="reset-photo" title="Undo every change you made on this photo only">Reset all changes on this photo</button>
        </div>` : ''}`;
    }
    if (sel.kind === 'house') {
      return `<h3 class="sec">House marker</h3>
        ${ui.check('Show house marker on this photo', 'photo.pin')}
        ${ui.color('Pin color', 'style.pinColor', '#e11d48')}
        ${ui.range('Pin size', 'style.pinSize', 20, 160, 1)}
        <div class="btn-col">
          <button class="btn block" data-act="house-place">Place the pin by clicking the photo</button>
          <button class="btn block" data-act="house-reset">Move pin back to the address location</button>
          ${alignButton(photo())}
        </div>
        <p class="hint">If the callouts are all slightly off, drag the pin onto the house first, then click <b>Line up all callouts</b>. It turns the camera direction to match.</p>`;
    }
    if (sel.kind === 'lot') return lotPanel();
    if (sel.kind === 'cat') {
      const c = catById(sel.id);
      if (!c) return '';
      return `<h3 class="sec">Category</h3>
        ${ui.text('Name', 'cat.name')}
        <div class="field row between"><label>Icon</label><button class="btn" data-act="cat-icon">${iconHtml(c.icon, c.color)} Change</button></div>
        ${ui.color('Color', 'cat.color', '#57606a')}
        ${ui.check('Turned on', 'cat.enabled')}
        ${c.id !== 'custom' ? ui.range('Show places within', 'cat.maxMi', 0.25, c.rangeMax || 15, 0.25, { unit: ' mi' }) : ''}
        <div class="field row between"><label>Order in the list</label><span class="row">
          <button class="btn small" data-act="cat-up" title="Move up">▲ Up</button><button class="btn small" data-act="cat-down" title="Move down">▼ Down</button></span></div>
        <p class="hint">Or drag the <b>⋮⋮</b> handle in the sidebar. The order is remembered for every job.</p>
        ${c.user ? '<button class="btn block danger" data-act="cat-delete">Delete category</button>' : ''}`;
    }
    const p = S.places[sel.id];
    if (!p) return '';
    const cat = catById(p.cat) || {};
    const ph = photo();
    const lay = (ph && ph.layout[p.id]) || {};
    const drive = p.drive ? `${Math.round(p.drive.min)} min · ${p.drive.mi.toFixed(1)} mi drive` : (wantsDrive(p) ? 'Getting drive time…' : '');
    return `<h3 class="sec">Callout</h3>
      ${ui.text('Text', 'place.title', p.name)}
      <p class="hint">${p.source === 'osm' ? 'From OpenStreetMap: ' + esc(p.name) + (placeMem[p.id] ? ' · your edits are remembered for future jobs' : '') : p.source === 'mine' ? '★ Saved in My places: shows on future jobs nearby' : 'Your own callout (this job only)'}${p.distMi != null && p.source !== 'custom' ? ' · ' + fmtMi(p.distMi) + ' away' : ''}${drive ? ' · ' + drive : ''}</p>
      <div class="field"><label>Category</label><select data-act="place-cat">${S.categories.map(c => `<option value="${esc(c.id)}" ${c.id === p.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field row between"><label>Icon</label><span class="row">
        ${p.icon ? '<button class="btn small subtle" data-act="reset" data-path="place.icon">Reset</button>' : ''}
        <button class="btn" data-act="place-icon">${iconHtml(p.icon || p.kindIcon || cat.icon, p.iconColor || cat.color)} Change</button></span></div>
      ${ui.color('Icon / accent color', 'place.iconColor', cat.color, true)}
      ${ui.color('Box color', 'place.boxColor', colorsFor(p, cat).box, true)}
      ${ui.color('Text color', 'place.textColor', colorsFor(p, cat).text, true)}
      ${ui.color('Line color', 'place.lineColor', S.style.lineColor, true)}
      ${ui.select('Drive time / distance', 'place.showDrive', [['', 'Use the main setting'], ['on', 'Always show'], ['off', 'Never show']])}
      ${p.source !== 'custom' ? ui.range('Distance limit for this place', 'place.maxMi', 0.25, cat.rangeMax || 15, 0.25, { unit: ' mi', fallback: cat.maxMi }) : ''}
      ${p.source !== 'custom' ? ui.check('Always show (ignore distance)', 'place.always') : ''}
      <h3 class="sec">This photo</h3>
      <div class="btn-col">
        <button class="btn block" data-act="reset-box" ${lay.box ? '' : 'disabled'}>Let the app position the box</button>
        <button class="btn block" data-act="reset-dot" ${lay.anchor && !p.photoOnly ? '' : 'disabled'}>Move the dot back to the map location</button>
        <button class="btn block" data-act="hide-here">${ph && !shownOn(p, ph) ? 'Show in this photo' : 'Hide in this photo only'}</button>
      </div>
      <h3 class="sec">All photos</h3>
      <div class="btn-col">
        <button class="btn block" data-act="toggle-place">${p.enabled === false ? 'Show this callout' : 'Hide this callout'}</button>
        ${p.source === 'custom' && p.lat != null ? '<button class="btn block" data-act="save-mine">★ Save to My places (show on future jobs)</button>' : ''}
        ${p.source === 'custom' ? '<button class="btn block danger" data-act="delete-place">Delete this callout</button>' : ''}
        ${p.source === 'mine' ? '<button class="btn block" data-act="unsave-mine">Keep for this job only (remove from My places)</button><button class="btn block danger" data-act="delete-place">Delete this place everywhere</button>' : ''}
        ${p.source === 'osm' && placeMem[p.id] ? '<button class="btn block subtle" data-act="forget-place">Forget my edits for future jobs</button>' : ''}
      </div>`;
  }

  function lotPanel() {
    const L = curLot();
    const ac = L && (L.edited ? lotAcres() : L.acres ?? lotAcres());
    const ph = photo();
    const others = S.photos.map((x, i) => ({ x, i })).filter(o => o.i !== cur && o.x.lot && !o.x.ground);
    if (ph && ph.ground) return `<h3 class="sec">Lot lines</h3><p class="hint">Lot lines need a drone photo. Pick a drone photo in the strip below.</p>`;
    const sc = scene && scene.pop;
    return `<h3 class="sec">Lot lines on this photo</h3>
      ${L ? `<p class="hint">From: <b>${esc(L.source)}</b>${L.edited && L.source !== 'drawn by hand' ? ' (adjusted by you)' : ''}${ac ? ` · about ${ac.toFixed(2)} acres` : ''}</p>` : '<p class="hint">No lot lines on this photo. Each photo gets its own, so adding them here won’t change your other photos.</p>'}
      ${L ? ui.check('Show the lines', 'lot.lines') + ui.check('Color callout: lot in color, surroundings gray', 'lot.pop') : ''}
      ${L && L.pop ? `<div class="sub-fields">
        ${ui.range('How gray', 'style.popGray', 0.2, 1, 0.05, { fallback: 1, fmt: (x) => Math.round(x * 100) + '%' })}
        ${ui.range('Darken surroundings', 'style.popDark', 0, 0.5, 0.02, { fallback: 0, fmt: (x) => Math.round(x * 100) + '%' })}
        ${ui.check('Keep the sky in color', 'style.popSky')}
        ${S.style.popSky !== false ? (sc && sc.sky ? ui.range('Move the sky line', 'lot.sky', -0.15, 0.15, 0.002, { fallback: 0, fmt: (x) => (x > 0 ? 'down ' : x < 0 ? 'up ' : '') + Math.abs(Math.round(x * 1000) / 10) + '%' }) : '<p class="hint">No sky in this shot.</p>') : ''}
        <p class="hint">To keep the house or trees that stick out past the lot in color, mark them below as <b>on the property</b>. Mark a neighbor’s tree as <b>off the property</b> to turn it gray.</p>
      </div>` : ''}
      <div class="btn-col">
        <button class="btn block" data-act="lot-find">${L ? 'Look up the lot lines again' : 'Find lot lines automatically'}</button>
        <button class="btn block" data-act="lot-find-pin" ${photo() && photo().house ? '' : 'disabled'} title="Uses the spot where you dragged the house pin on this photo">Find the lot under the house pin</button>
        <button class="btn block" data-act="lot-draw">Draw lot lines by hand</button>
        ${others.length ? `<p class="hint">Or copy the outline from another photo (it won’t stay linked):</p>${others.slice(0, 6).map(o => `<button class="btn block subtle" data-act="lot-copy" data-from="${o.i}">Copy from ${esc(o.x.name)}</button>`).join('')}` : ''}
        ${L ? '<button class="btn block danger" data-act="lot-delete">Remove lot lines from this photo</button>' : ''}
      </div>
      ${L && sel && sel.vertex != null && L.ring[sel.vertex] ? `<div class="btn-col"><p class="hint"><b>Corner selected.</b></p><button class="btn block" data-act="lot-del-corner">Delete this corner</button></div>` : ''}
      ${L && sel && sel.edge != null && L.ring[sel.edge] ? `<div class="btn-col"><p class="hint"><b>Side selected.</b></p><button class="btn block" data-act="lot-toggle-side">${L.ring[sel.edge][2] ? 'Bring this side back' : 'Delete this side'}</button></div>` : ''}
      ${L && L.ring.some(c => c[2]) ? '<button class="btn block" data-act="lot-all-sides">Bring back all deleted sides</button>' : ''}
      ${L ? `<h3 class="sec">Mask: house &amp; trees</h3>
        <p class="hint">Mark what the lot lines should go <i>behind</i> on this photo (house, trees, pool…)${L.pop ? ', and what should stay in color or go gray' : ''}. Callouts always stay in front.${photo() && photo().lotMask ? ' <b>This photo has a mask.</b>' : ''}</p>
        <div class="btn-col">
          <button class="btn block" data-act="mask-edit" ${photo() && !photo().ground && (L.lines !== false || L.pop) ? '' : 'disabled'}>${photo() && photo().lotMask ? 'Edit the mask on this photo' : 'Mask this photo…'}</button>
          ${photo() && photo().lotMask ? '<button class="btn block subtle" data-act="mask-clear">Clear the mask on this photo</button>' : ''}
        </div>` : ''}
      <ul class="tips"><li>Drag a <b>corner</b> to move it (this photo only).</li><li>Drag a small <b>middle handle</b> to add a corner.</li><li>Click a <b>corner</b> or a <b>side</b>, then press <b>Delete</b> to remove it. Deleted sides show as a faint dashed line while editing; click one and press Delete again to bring it back.</li><li><b>Scroll out</b> past the edge of the photo to reach corners that are out of frame.</li></ul>
      <p class="hint">Automatic lookup uses county appraisal district maps (${esc(PL.LOT_COVERAGE)}). If it picks the wrong lot, drag the house pin onto the house and use “Find the lot under the house pin”, or draw by hand.</p>
      <h3 class="sec">Look</h3>
      ${ui.color('Line color', 'style.lotColor', '#ffffff')}
      ${ui.range('Line thickness', 'style.lotWidth', 0.5, 10, 0.1, { fallback: 2.5 })}
      ${ui.select('Line style', 'style.lotDash', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']])}
      ${ui.range('Fill', 'style.lotFill', 0, 0.6, 0.02, { fallback: 0, fmt: (x) => Math.round(x * 100) + '%' })}
      <h3 class="sec">Disclaimer</h3>
      ${ui.check('Add a disclaimer when lot lines or a color callout are shown', 'style.lotNote')}
      ${S.style.lotNote !== false ? ui.text('Text', 'style.lotNoteText', LOT_NOTE_TEXT) : ''}
      <p class="hint">Uses the same corner and text size as the school disclaimer (Style tab).</p>`;
  }

  function styleTab() {
    return `<h3 class="sec">Text</h3>
      ${ui.select('Font', 'style.font', FONTS.map(f => [f, f]))}
      ${ui.select('Weight', 'style.fontWeight', [[500, 'Medium'], [600, 'Semi-bold'], [700, 'Bold']])}
      ${ui.range('Text size', 'style.fontSize', 6, 40, 0.5)}
      <h3 class="sec">Box</h3>
      ${ui.select('Box style', 'style.boxStyle', [['light', 'White box, dark text'], ['dark', 'Dark box, white text'], ['category', 'Category color box'], ['custom', 'My own colors']])}
      ${S.style.boxStyle === 'custom' ? ui.color('Box color', 'style.boxBg', '#ffffff') + ui.color('Text color', 'style.textColor', '#16181d') : ''}
      ${ui.range('Box opacity', 'style.boxOpacity', 0.3, 1, 0.05)}
      ${ui.range('Corner roundness', 'style.radius', 0, 30, 0.5)}
      ${ui.range('Border thickness', 'style.borderWidth', 0, 6, 0.25)}
      ${S.style.borderWidth > 0 ? ui.color('Border color', 'style.borderColor', '#ffffff') : ''}
      ${ui.check('Show icons', 'style.showIcons')}
      ${ui.select('Icon shape', 'style.iconShape', [['rounded', 'Rounded square'], ['circle', 'Circle']])}
      <h3 class="sec">Line &amp; dot</h3>
      ${ui.color('Line color', 'style.lineColor', '#ffffff')}
      ${ui.range('Line thickness', 'style.lineWidth', 0.5, 10, 0.1)}
      ${ui.select('Line style', 'style.lineDash', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']])}
      ${ui.range('Line length', 'style.leader', 10, 300, 1)}
      ${ui.range('Dot size', 'style.dotSize', 0, 20, 0.25)}
      ${ui.select('Dot color', 'style.dotColorMode', [['category', 'Match category color'], ['custom', 'One color for all']])}
      ${S.style.dotColorMode === 'custom' ? ui.color('Dot color', 'style.dotColor', '#ffffff') : ''}
      ${ui.range('Dot white ring', 'style.dotRing', 0, 6, 0.1)}
      <h3 class="sec">House marker</h3>
      ${ui.check('Show house marker on this photo', 'photo.pin')}
      ${ui.color('Pin color', 'style.pinColor', '#e11d48')}
      ${ui.range('Pin size', 'style.pinSize', 20, 160, 1)}
      <h3 class="sec">Lot lines</h3>
      <button class="btn block" data-act="lot-edit">${curLot() ? 'Edit lot lines on this photo…' : 'Add lot lines to this photo…'}</button>
      <h3 class="sec">School disclaimer</h3>
      ${ui.check('Add a disclaimer when a school is shown', 'style.schoolNote')}
      ${S.style.schoolNote ? ui.text('Text', 'style.schoolNoteText', SCHOOL_NOTE_TEXT) : ''}
      ${ui.range('Disclaimer text size', 'style.schoolNoteSize', 5, 30, 0.5, { fallback: 10 })
        + ui.select('Disclaimer corner', 'style.schoolNotePos', [['bottom-right', 'Bottom right'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['top-left', 'Top left']])
        + '<p class="hint">The school disclaimer only appears on photos with a public, private or charter school callout. Size and corner apply to the lot-lines disclaimer too. Saved with your presets.</p>'}
      <div class="btn-col">
        <button class="btn block" data-act="rearrange">Re-arrange callouts on this photo</button>
        <button class="btn block subtle" data-act="rearrange-all">Re-arrange on all photos</button>
      </div>`;
  }

  // Compare the drone's sea-level reading with the ground at the house
  // (USGS). Takeoff ground = sea-level altitude − height above takeoff.
  // If that's well above or below the house, the height reading is off by
  // about the difference. Drone sea-level readings can themselves be off by
  // tens of feet, so this is a hint with a button, never applied silently.
  const groundAt = {}; // "lat,lon" -> meters | null | 'loading'
  function altitudeCheck(ph) {
    const m = ph.meta;
    const spot = S.house || (m.hasGps ? { lat: m.lat, lon: m.lon } : null);
    if (m.absAlt == null || m.relAlt == null || !spot) return '';
    const key = spot.lat.toFixed(5) + ',' + spot.lon.toFixed(5);
    if (!(key in groundAt)) {
      groundAt[key] = 'loading';
      SV.groundElevation(spot.lat, spot.lon).then((v) => { groundAt[key] = v; if (photo() === ph) renderInspector(); });
    }
    const g = groundAt[key];
    if (g === 'loading') return '<p class="hint">Checking the ground height at the house…</p>';
    if (g == null) return '';
    const where = S.house ? 'the house' : 'the drone’s spot';
    const takeoff = m.absAlt - m.relAlt;      // meters above sea level
    const diffFt = Math.round((takeoff - g) / FT);
    const estFt = Math.round((m.absAlt - g) / FT);
    const groundFt = Math.round(g / FT);
    if (estFt < 3 || Math.abs(diffFt) > 1500) return `<p class="hint">The drone’s sea-level reading (${Math.round(m.absAlt / FT)} ft) doesn’t fit the ground at ${where} (${groundFt} ft), so it can’t help check the height here.</p>`;
    if (Math.abs(diffFt) < 25) return `<p class="hint">✓ Takeoff spot and ${where} look about level (ground ${groundFt} ft above sea level), so the photo’s reading should be close.</p>`;
    return `<div class="note warn">Your takeoff spot looks about <b>${Math.abs(diffFt)} ft ${diffFt > 0 ? 'higher' : 'lower'}</b> than the ground at ${where}. That would put the drone about <b>${estFt} ft</b> above ${where}, not ${Math.round(m.relAlt / FT)} ft.
      <br><span class="hint">Based on the drone’s sea-level reading and USGS ground height. Drone sea-level readings can be off by 30 ft or more, so check the callouts after.</span>
      <div class="btn-col"><button class="btn small" data-act="alt-set" data-m="${(estFt * FT).toFixed(4)}">Use ${estFt} ft</button></div></div>`;
  }

  function cameraTab() {
    const ph = photo();
    if (!ph) return '<div class="hint-card"><p>Add a photo to see its camera information.</p></div>';
    const m = ph.meta, a = ph.adj;
    if (ph.ground) return `<div class="note"><b>Eye-level photo.</b> It has no drone camera data${m.hasGps ? '' : ' or GPS'}, so the app doesn’t try to work out where places are. Tick places in <b>This photo</b> view and drag them where you want them.</div>
      <div class="btn-col"><button class="btn block" data-act="make-drone">It’s a drone photo: line it up by hand</button></div>`;
    const manual = PJ.isManual(ph);
    const ft = (mm) => mm == null ? '—' : Math.round(mm / FT) + ' ft';
    let html = '';
    if (m.hasDirection) {
      html += `<div class="note ok"><b>✓ Camera-direction data found.</b> Callouts are placed automatically from this photo’s GPS, height and gimbal angles.</div>
        <dl class="facts">
          <dt>Camera</dt><dd>${esc([m.make, m.model].filter(Boolean).join(' ') || '—')}</dd>
          <dt>Height above takeoff</dt><dd>${ft(m.relAlt)}</dd>
          ${m.absAlt != null ? `<dt>Height above sea level</dt><dd>${ft(m.absAlt)} <span class="hint">(rough)</span></dd>` : ''}
          <dt>Facing</dt><dd>${m.yaw != null ? ((PJ.baseYaw(ph) + 360) % 360).toFixed(1) + '° ' + compass(PJ.baseYaw(ph)) : '—'}</dd>
          <dt>Tilt</dt><dd>${m.pitch != null ? m.pitch.toFixed(1) + '°' : '—'}</dd>
          <dt>Lens (35mm equiv.)</dt><dd>${m.f35 ? m.f35 + ' mm' : '24 mm (assumed)'}</dd>
          ${m.digitalZoom > 1.01 ? `<dt>Digital zoom</dt><dd>${(+m.digitalZoom).toFixed(1)}× (use Line up with 3+ points to correct)</dd>` : ''}
          ${m.crop ? '<dt>Lightroom crop</dt><dd>Detected, accounted for</dd>' : ''}
        </dl>`;
    } else {
      html += `<div class="note warn"><b>⚠ No camera-direction data in this file.</b>
        ${m.hasDjiXmp ? 'The DJI data is there but incomplete.' : 'The DJI camera data was removed when the photo was exported.'}
        <br><br><b>To fix:</b> in Lightroom’s Export window, under <b>Metadata</b>, set <b>Include</b> to <b>All Metadata</b> and untick <b>Remove Location Info</b>. Then export again.
        <br><br>For now you can line things up by hand below.</div>
        <dl class="facts"><dt>GPS position</dt><dd>${m.hasGps ? 'Found' : 'Missing'}</dd><dt>Lens</dt><dd>${m.f35 ? m.f35 + ' mm' : '24 mm (assumed)'}</dd></dl>`;
    }
    const gap = PJ.headingGap(m);
    if (!manual && m.flightYaw != null && gap > 2) {
      const deg = (v) => ((v + 360) % 360).toFixed(1) + '°';
      html += `<h3 class="sec">Compass reading</h3>
        ${gap > 8 ? `<div class="note warn">This photo’s two compass readings disagree by <b>${gap.toFixed(0)}°</b>. If all callouts look turned sideways, switch to the other one.</div>` : ''}
        ${ui.select('Trust the heading from', 'adj.heading', [['gimbal', `Camera gimbal (${deg(m.yaw)})`], ['body', `Drone body (${deg(m.flightYaw)})`]])}
        <p class="hint">Your choice is remembered for this camera (${esc(m.model || 'unknown model')}).</p>`;
    }
    if (!manual) {
      html += `<h3 class="sec">Altitude</h3>
        ${ui.altitude('adj.height', m.relAlt, 60)}
        <p class="hint">The drone measures height from where it <b>took off</b>, not from the ground under it. If you took off from higher or lower ground than the house (a hill, a raised driveway, down the street), set the height above the house here. Too low a height pushes far-away callouts toward the horizon; too high pulls them closer.</p>
        ${altitudeCheck(ph)}
        <h3 class="sec">Fine-tune</h3>
        <p class="hint">Drone compasses can be off by a few degrees. Easiest fix: drag the house pin onto the house, and drag the dots of two or three callouts you can see clearly (a school building, a lake) onto the right spots. Then click <b>Line up</b> below.</p>
        ${ui.range('Turn left / right', 'adj.dYaw', -45, 45, 0.1, { unit: '°' })}
        ${ui.range('Tilt up / down', 'adj.dPitch', -15, 15, 0.1, { unit: '°' })}
        ${ui.range('Level', 'adj.dRoll', -10, 10, 0.1, { unit: '°' })}
        ${ui.range('Lens zoom', 'adj.zoom', 0.6, 1.6, 0.005, { fmt: (x) => (+x).toFixed(3) + '×' })}
        ${ui.check('Set the camera by hand instead', 'adj.manual')}`;
    } else {
      html += `<h3 class="sec">Camera by hand</h3>
        <p class="hint">Move these until the house pin and a landmark you recognise line up. Then use <b>Copy to all photos</b> if the other shots were taken from the same spot.</p>
        ${ui.range('Facing (compass)', 'adj.mYaw', 0, 360, 0.5, { unit: '°', fmt: (x) => (+x).toFixed(1) })}
        ${ui.range('Tilt', 'adj.mPitch', -90, 0, 0.1, { unit: '°' })}
        ${ui.altitude('adj.mHeight', m.relAlt, 61)}
        ${m.hasGps ? '' : ui.range('Drone distance from house', 'adj.mDist', 0, 3000, 5, { scale: FT, unit: ' ft', fmt: (x) => Math.round(x) })
          + ui.range('Drone direction from house', 'adj.mBearing', 0, 360, 1, { unit: '°', fmt: (x) => Math.round(x) + '° ' + compass(+x) })}
        ${ui.range('Level', 'adj.dRoll', -10, 10, 0.1, { unit: '°' })}
        ${ui.range('Lens zoom', 'adj.zoom', 0.6, 1.6, 0.005, { fmt: (x) => (+x).toFixed(3) + '×' })}
        ${m.hasGps ? '' : '<button class="btn block" data-act="aim-house">Point the camera at the house</button>'}
        ${m.hasDirection ? ui.check('Set the camera by hand', 'adj.manual') : ''}`;
    }
    html += `<div class="btn-col">
        ${alignButton(ph)}
        <button class="btn block" data-act="copy-adj" ${S.photos.length > 1 ? '' : 'disabled'}>Copy these settings to all photos</button>
        <button class="btn block subtle" data-act="reset-adj">Reset camera settings</button>
        <button class="btn block subtle" data-act="reset-photo" title="Camera, pin, callout positions, shown/hidden places, lot lines and mask on this photo">Reset all changes on this photo</button>
        <button class="btn block subtle" data-act="make-ground" title="Stop placing callouts automatically on this photo">Treat as eye-level (add places by hand)</button>
      </div>`;
    return html;
  }

  // The house pin plus callout dots you've dragged to the right spot. Roads
  // are left out: a dot on a road could be anywhere along it.
  function alignTargets(ph) {
    if (!ph || !S.house) return [];
    const t = [];
    if (ph.house) t.push({ lat: S.house.lat, lon: S.house.lon, x: ph.house.x * ph.W, y: ph.house.y * ph.H });
    for (const [id, lay] of Object.entries(ph.layout)) {
      const p = S.places[id];
      if (!lay.anchor || !p || p.source !== 'osm') continue;
      const g = geom.get(id);
      if (g && g.kind === 'line') continue;
      const ll = g && g.kind === 'area' ? g.centroid : [p.lat, p.lon];
      t.push({ id, lat: ll[0], lon: ll[1], x: lay.anchor.x * ph.W, y: lay.anchor.y * ph.H });
    }
    return t;
  }
  function alignButton(ph) {
    const n = alignTargets(ph).length;
    const label = !n ? 'Line up (drag the house pin or some dots first)'
      : n === 1 ? (ph.house ? 'Line up using the house pin' : 'Line up using the dot I moved')
      : `Line up using ${n} points I placed`;
    return `<button class="btn block" data-act="align-house" ${n ? '' : 'disabled'} title="Turns, tilts (and with 3+ points zooms) the camera so the points match">${label}</button>`;
  }

  function compass(deg) {
    const d = ((deg % 360) + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];
  }

  function presetsTab() {
    return `<h3 class="sec">My default setup</h3>
      <p class="hint">Saves your categories, distances, colors and callout style. New jobs start this way.</p>
      <div class="btn-col">
        <button class="btn block primary" data-act="save-default">Save current setup as my default</button>
        <button class="btn block" data-act="load-default">Apply my default to this job</button>
      </div>
      <h3 class="sec">Named presets</h3>
      <div class="row"><input type="text" id="presetName" placeholder="e.g. Luxury listing"><button class="btn" data-act="save-preset">Save</button></div>
      <ul class="preset-list" id="presetList"><li class="none">Loading…</li></ul>
      <h3 class="sec">My places <span class="muted-n">${myPlaces.length}</span></h3>
      <p class="hint">Places you added by clicking a photo. Each one shows up automatically on future jobs within range. Click a photo spot with <b>+ Add a callout</b> to add more.</p>
      <ul class="preset-list myplaces-list">${myPlaces.slice().sort((a, b) => byName(a.name, b.name)).map(m => {
        const c = catById(m.cat) || catById('custom');
        const d = S.house ? fmtMi(PJ.distM(S.house.lat, S.house.lon, m.lat, m.lon) / MI) + ' away' : '';
        return `<li data-mine="${esc(m.id)}">${iconHtml(m.icon || c.icon, m.iconColor || c.color)}<span class="mp-name">${esc(m.name)}<small>${esc(c.name)}${d ? ' · ' + d : ''}</small></span>
          <button class="btn small subtle" data-act="mine-delete" title="Delete from My places">✕</button></li>`;
      }).join('') || '<li class="none">None yet.</li>'}</ul>
      <h3 class="sec">Logo library</h3>
      <p class="hint">Upload school logos, highway shields or any image. <b>Match style</b> turns it into a one-color icon like the built-in ones; <b>Original colors</b> keeps it as-is on a white tile.</p>
      <label class="btn block">Upload logos…<input type="file" id="libUpload" accept="image/*" multiple hidden></label>
      <datalist id="logoGroups">${logoGroupNames().map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      ${logos.length ? logoGroupsSorted().map(([g, ls]) => `<div class="logo-group-h">${esc(g)} <span>${ls.length}</span></div>
      <ul class="logo-list">${ls.map(l => `<li data-logo="${l.id}">
        <span class="ico" style="background:#57606a"><img src="${l.glyph}" alt=""></span>
        <span class="ico badge"><img src="${l.badge}" alt=""></span>
        <div class="logo-fields">
          <input type="text" data-act="logo-name" value="${esc(l.name)}" title="Logo name">
          <div class="row"><input type="text" data-act="logo-group" list="logoGroups" value="${esc(l.group || '')}" placeholder="Group (e.g. Highways)" title="Group">
          <select data-act="logo-mode"><option value="glyph" ${l.mode !== 'badge' ? 'selected' : ''}>Match style</option><option value="badge" ${l.mode === 'badge' ? 'selected' : ''}>Original colors</option></select></div>
        </div>
        <button class="btn small subtle" data-act="logo-delete" title="Delete">✕</button></li>`).join('')}</ul>`).join('') : '<p class="hint">No logos yet.</p>'}
      <p class="hint">Stored in: <b>${esc(SV.store.backend)}</b>. Saving to your Google Drive comes with hosting.</p>`;
  }

  async function renderPresetList() {
    const el = $('#presetList');
    if (!el) return;
    const presets = await SV.store.load('presets', {});
    const names = Object.keys(presets).sort();
    el.innerHTML = names.map(n => `<li data-preset="${esc(n)}"><span>${esc(n)}</span><span class="row"><button class="btn small" data-act="apply-preset">Apply</button><button class="btn small subtle" data-act="delete-preset">✕</button></span></li>`).join('') || '<li class="none">None saved yet.</li>';
  }

  // Inspector events
  const insp = $('#inspector');
  insp.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.path || t.type === 'text') return;
    applyInput(t);
    if (t.closest('.alt-field')) syncAltitude(t);
    else if (t.type === 'range') {
      const out = t.parentElement.querySelector('output');
      const dec = +t.dataset.dec;
      if (out) out.textContent = formatOut(t, dec);
    }
    if (t.dataset.path.startsWith('style.font')) ensureFont().then(redraw);
    redraw();
  });
  // Keep the altitude slider and number box showing the same height.
  function syncAltitude(t) {
    const f = t.closest('.alt-field');
    const ft = Math.round(getPath(t.dataset.path) / FT);
    if (t.type === 'range') f.querySelector('.alt-num').value = ft;
    else f.querySelector('.alt-range').value = altPos(ft);
  }
  function formatOut(t, dec) {
    const v = +t.value, unit = t.dataset.unit || '';
    if (t.dataset.path === 'adj.zoom') return v.toFixed(3) + '×';
    if (unit === ' ft') return Math.round(v) + unit;
    if (t.dataset.path === 'adj.mBearing') return Math.round(v) + '° ' + compass(v);
    return v.toFixed(dec) + unit;
  }
  function applyInput(t) {
    const type = t.dataset.type;
    let v;
    if (type === 'bool') v = t.checked;
    else if (type === 'alt') v = altFt(+t.value) * FT;
    else if (type === 'num') {
      v = parseFloat(t.value) * (parseFloat(t.dataset.scale) || 1);
      if (!isFinite(v)) return; // half-typed number box
      if (t.classList.contains('alt-num')) v = Math.max(ALT_MIN * FT, v);
    }
    else v = t.value;
    if (type === 'bool' && !v && t.dataset.path.startsWith('place.')) v = null;
    setPath(t.dataset.path, v);
  }
  insp.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.path) {
      applyInput(t);
      if (t.dataset.path === 'place.maxMi' || t.dataset.path === 'cat.maxMi') maybeRefetch();
      if (t.dataset.path === 'adj.heading') {
        const model = photo().meta.model || '';
        cameraPrefs[model] = t.value;
        SV.store.save('cameraPrefs2', cameraPrefs);
        for (const x of S.photos) if ((x.meta.model || '') === model) x.adj.heading = t.value;
      }
      if (t.dataset.path.startsWith('style.font')) ensureFont().then(redraw);
      commit();
      const keepFocus = t.type === 'range';
      redraw(); renderSidebar(); renderFilmstrip();
      if (!keepFocus || /^(style\.(boxStyle|dotColorMode|borderWidth|schoolNote|showLot|lotNote|popSky)|adj\.manual|lot\.(lines|pop))$/.test(t.dataset.path) || t.closest('.alt-field')) renderInspector();
      maybeFetchDrive();
      return;
    }
    const act = t.dataset.act;
    if (act === 'place-cat') {
      const p = S.places[sel.id];
      p.cat = t.value; p.userCat = true;
      const c = catById(t.value);
      if (c) {
        c.enabled = true; c.open = true;
        if (c.used === false) { c.used = true; placeTypes[c.id] = { ...(placeTypes[c.id] || {}), used: true }; SV.store.save('placeTypes', placeTypes); }
      }
      commit(); renderAll();
    } else if (act === 'logo-name' || act === 'logo-mode' || act === 'logo-group') {
      const l = logos.find(x => x.id === t.closest('li').dataset.logo);
      if (act === 'logo-name') l.name = t.value.trim() || l.name;
      else if (act === 'logo-group') l.group = t.value.trim();
      else l.mode = t.value;
      saveLogos();
      renderAll();
      if (act !== 'logo-mode') renderInspector(); // re-sort
    } else if (t.id === 'libUpload') {
      uploadLogos(t.files).then(() => renderInspector());
    }
  });
  insp.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const ph = photo();
    const p = sel && sel.kind === 'place' ? S.places[sel.id] : null;
    switch (t.dataset.act) {
      case 'reset': setPath(t.dataset.path, null); break;
      case 'alt-set': if (ph) ph.adj.height = +t.dataset.m; break;
      case 'alt-photo':
        // Automatic mode falls back to the photo's reading when unset; by-hand mode needs the value.
        if (t.dataset.path === 'adj.height') setPath('adj.height', null);
        else if (ph && ph.meta.relAlt != null) setPath(t.dataset.path, ph.meta.relAlt);
        break;
      case 'place-icon':
        openIconPicker(p.icon || catById(p.cat).icon, (key) => { p.icon = key; rememberIcon(p, key); commit(); renderAll(); }, pickCtx(p));
        return;
      case 'cat-icon': {
        const c = catById(sel.id);
        openIconPicker(c.icon, (key) => { c.icon = key; commit(); renderAll(); }, { group: GROUP_FOR_CAT[c.id] });
        return;
      }
      case 'cat-up': case 'cat-down': {
        const vis = S.categories.filter(x => x.used !== false);
        const c = catById(sel.id), k = vis.indexOf(c);
        const o = vis[k + (t.dataset.act === 'cat-up' ? -1 : 1)];
        if (o) moveCat(c.id, o.id, t.dataset.act === 'cat-down');
        return;
      }
      case 'cat-delete': {
        const c = catById(sel.id);
        if (!confirm(`Delete the category “${c.name}”? Its callouts move to “My callouts”.`)) return;
        for (const pl of Object.values(S.places)) if (pl.cat === c.id) pl.cat = 'custom';
        S.categories = S.categories.filter(x => x !== c);
        sel = null;
        break;
      }
      case 'reset-box': delete ph.layout[p.id].box; break;
      case 'reset-dot': delete ph.layout[p.id].anchor; break;
      case 'hide-here': setShownOn(p, ph, !shownOn(p, ph)); break;
      case 'toggle-place': p.enabled = p.enabled === false; break;
      case 'save-mine': saveToMyPlaces(p); break;
      case 'unsave-mine': removeFromMyPlaces(p.id); p.source = 'custom'; break;
      case 'forget-place': delete placeMem[p.id]; SV.store.save('placeMemory', placeMem); delete p.title; delete p.icon; break;
      case 'delete-place':
        if (p.source === 'mine') {
          if (!confirm(`Delete “${p.title ?? p.name}” from My places? It won’t appear on future jobs.`)) return;
          removeFromMyPlaces(p.id);
        }
        delete S.places[p.id];
        for (const x of S.photos) { delete x.layout[p.id]; delete x.hidden[p.id]; }
        sel = null;
        break;
      case 'house-reset': ph.house = null; break;
      case 'house-place': startPlacePin(); return;
      case 'reset-photo': {
        if (!ph) return;
        if (!confirm('Reset everything you changed on this photo? Camera settings, the house pin, callout positions, places shown or hidden here, lot lines and mask all go back to how they started. (⌘Z undoes this.)')) return;
        const fresh = newPhoto(ph.name, ph.W, ph.H, ph.meta);
        ph.adj = fresh.adj; ph.layout = {}; ph.hidden = {}; ph.house = null; ph.ground = fresh.ground;
        delete ph.lot; delete ph.lotMask;
        sel = null;
        setStatus('This photo is back to how it started.', 'ok');
        break;
      }
      case 'make-drone': ph.ground = false; ph.adj.manual = true; break;
      case 'make-ground': ph.ground = true; break;
      case 'lot-edit': select({ kind: 'lot' }); if (!curLot() && S.house) autoFindLot(); return;
      case 'lot-find': autoFindLot(); return;
      case 'lot-find-pin': {
        const cam = PJ.buildCamera(ph, S.house);
        const ll = cam && ph.house && PJ.unproject(cam, ph.house.x * ph.W, ph.house.y * ph.H);
        if (ll) autoFindLot(ll);
        return;
      }
      case 'lot-draw': startDrawLot(); return;
      case 'lot-delete': delete ph.lot; delete ph.lotMask; sel = null; break;
      case 'lot-copy': {
        const src = S.photos[+t.dataset.from];
        if (src && src.lot) { ph.lot = clone(src.lot); }
        break;
      }
      case 'lot-del-corner': deleteLotCorner(sel.vertex); return;
      case 'lot-toggle-side': toggleLotSide(sel.edge); return;
      case 'mask-edit': startMask(); return;
      case 'mask-clear': delete ph.lotMask; if (mode === 'mask') maskSync(); break;
      case 'lot-all-sides': for (const c of curLot().ring) c.length = 2; curLot().edited = true; break;
      case 'align-house': {
        const targets = alignTargets(ph);
        if (!targets.length) return;
        const n = targets.length;
        const turn = PJ.isManual(ph) ? ['mYaw', 'mPitch'] : ['dYaw', 'dPitch'];
        const keys = n === 1 ? turn : n === 2 ? [...turn, 'dRoll'] : [...turn, 'dRoll', 'zoom'];
        const before = JSON.stringify(ph.adj);
        const err = PJ.solveFit(ph, S.house, targets, keys);
        if (err == null) { ph.adj = JSON.parse(before); setStatus('Couldn’t line up from those positions. Check the pin and dots, or use the sliders.', 'error'); return; }
        ph.house = null;
        for (const t of targets) if (t.id && ph.layout[t.id]) delete ph.layout[t.id].anchor;
        const pct = err / ph.W * 100;
        setStatus(`Camera lined up using ${n} point${n > 1 ? 's' : ''}${n > 1 ? ` (they now match within ${pct < 0.3 ? 'a hair' : pct.toFixed(1) + '% of the photo width'})` : ''}.`, pct < 1.5 ? 'ok' : 'error');
        break;
      }
      case 'aim-house':
        ph.adj.mYaw = (ph.adj.mBearing + 180) % 360;
        ph.adj.mPitch = -Math.atan2(ph.adj.mHeight, Math.max(1, ph.adj.mDist)) * 180 / Math.PI;
        break;
      case 'copy-adj':
        for (const x of S.photos) {
          if (x === ph) continue;
          for (const k of ['dYaw', 'dPitch', 'dRoll', 'zoom']) x.adj[k] = ph.adj[k];
          if (PJ.isManual(ph) && PJ.isManual(x)) for (const k of ['mYaw', 'mPitch', 'mHeight', 'mDist', 'mBearing']) x.adj[k] = ph.adj[k];
        }
        setStatus('Camera settings copied to all photos.', 'ok');
        break;
      case 'reset-adj': {
        const fresh = newPhoto(ph.name, ph.W, ph.H, ph.meta).adj;
        ph.adj = fresh;
        break;
      }
      case 'rearrange': for (const id in ph.layout) delete ph.layout[id].box; break;
      case 'rearrange-all': for (const x of S.photos) for (const id in x.layout) delete x.layout[id].box; break;
      case 'save-default':
        defaultPresetCache = currentPreset();
        await SV.store.save('defaultPreset', defaultPresetCache);
        setStatus('Saved as your default setup.', 'ok');
        return;
      case 'load-default': {
        const d = await SV.store.load('defaultPreset', null);
        if (!d) { setStatus('No default saved yet.', 'error'); return; }
        applyPreset(d);
        break;
      }
      case 'save-preset': {
        const name = $('#presetName').value.trim();
        if (!name) { $('#presetName').focus(); return; }
        const all = await SV.store.load('presets', {});
        all[name] = currentPreset();
        await SV.store.save('presets', all);
        $('#presetName').value = '';
        renderPresetList();
        setStatus(`Preset “${name}” saved.`, 'ok');
        return;
      }
      case 'apply-preset': {
        const all = await SV.store.load('presets', {});
        const pr = all[t.closest('li').dataset.preset];
        if (pr) applyPreset(pr);
        break;
      }
      case 'delete-preset': {
        const name = t.closest('li').dataset.preset;
        if (!confirm(`Delete preset “${name}”?`)) return;
        const all = await SV.store.load('presets', {});
        delete all[name];
        await SV.store.save('presets', all);
        renderPresetList();
        return;
      }
      case 'mine-delete': {
        const id = t.closest('li').dataset.mine;
        const m = myPlaces.find(x => x.id === id);
        if (!m || !confirm(`Delete “${m.name}” from My places? It won’t appear on future jobs.`)) return;
        removeFromMyPlaces(id);
        if (S.places[id]) S.places[id].source = 'custom';
        break;
      }
      case 'logo-delete': {
        const id = t.closest('li').dataset.logo;
        if (!confirm('Delete this logo from the library?')) return;
        logos = logos.filter(l => l.id !== id);
        await saveLogos();
        renderInspector();
        return;
      }
      default: return;
    }
    commit();
    renderAll();
  });

  // ---------------- Presets ----------------
  function currentPreset() {
    return {
      categories: S.categories.map(({ open, ...c }) => c),
      style: clone(S.style),
      master: S.master,
    };
  }
  function applyPreset(pr) {
    if (pr.style) S.style = { ...clone(DEFAULT_STYLE), ...clone(pr.style) };
    if (pr.categories) {
      const next = [];
      for (const c of pr.categories) {
        const existing = catById(c.id);
        next.push({ ...(existing || {}), ...clone(c), open: existing ? existing.open : false });
      }
      for (const c of S.categories) if (!next.find(x => x.id === c.id)) next.push(c);
      S.categories = next;
    }
    if (pr.master) S.master = pr.master;
    migrate();
    applyPlaceTypes();
    syncGlobalControls();
    ensureFont().then(redraw);
    maybeRefetch();
    setStatus('Preset applied.', 'ok');
  }

  // ---------------- Place types (which kinds of places you use) ----------------
  let placeTypes = {};   // remembered for every job: { catId: { used, roadTypes, minAcres } }
  function applyPlaceTypes() {
    for (const c of S.categories) {
      const t = placeTypes[c.id];
      if (!t) continue;
      if (t.used !== undefined) c.used = t.used;
      if (t.roadTypes && c.roadTypes) c.roadTypes = { ...c.roadTypes, ...t.roadTypes };
      if (t.minAcres && c.minAcres !== undefined) c.minAcres = t.minAcres;
    }
    applyCatOrder();
  }
  function renderTypes() {
    $('#typesBody').innerHTML = S.categories.filter(c => c.id !== 'custom' && !c.user).map(c => {
      const on = c.used !== false;
      let sub = '';
      if (c.roadTypes) sub = `<div class="type-sub">${PL.ROAD_TYPES.map(([k, label]) =>
        `<label><input type="checkbox" data-road="${k}" ${c.roadTypes[k] ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div>`;
      if (c.minAcres !== undefined) sub = `<div class="type-sub"><label>Counts as a large lake if at least <input type="number" data-acres min="10" step="10" value="${c.minAcres}"> acres</label>
        <p class="hint">Smaller water goes under “Ponds & small lakes”. For scale: Lewisville Lake ≈ 29,000 acres, White Rock Lake ≈ 1,000. Rivers always count as large.</p></div>`;
      if (c.id === 'shopping') sub = `<div class="type-sub"><p class="hint">“Major stores only” can be switched in the sidebar once this is on.</p></div>`;
      return `<div class="type-item ${on ? '' : 'off'}" data-cat="${esc(c.id)}">
        <label><input type="checkbox" data-used ${on ? 'checked' : ''}>${iconHtml(c.icon, c.color)} ${esc(c.name)}</label>
        ${on ? sub : ''}
      </div>`;
    }).join('');
  }
  $('#btnTypes').addEventListener('click', () => { renderTypes(); $('#typesDlg').showModal(); });
  $('#typesBody').addEventListener('change', (e) => {
    const t = e.target, c = catById(t.closest('.type-item').dataset.cat);
    if (t.hasAttribute('data-used')) { c.used = t.checked; if (c.used) c.enabled = true; renderTypes(); }
    else if (t.dataset.road) c.roadTypes[t.dataset.road] = t.checked;
    else if (t.hasAttribute('data-acres')) c.minAcres = Math.max(1, parseFloat(t.value) || 250);
    placeTypes[c.id] = { used: c.used !== false, ...(c.roadTypes ? { roadTypes: clone(c.roadTypes) } : {}), ...(c.minAcres !== undefined ? { minAcres: c.minAcres } : {}) };
    SV.store.save('placeTypes', placeTypes);
    renderAll();
  });
  $('#typesDlg').addEventListener('close', async () => { await mergeLandmarks(); commit(); maybeRefetch(); renderAll(); });

  // ---------------- Logos & icon picker ----------------
  async function loadLogos() {
    logos = await SV.store.load('logos', []);
    refreshLogoImages();
  }
  async function saveLogos() {
    const ok = await SV.store.save('logos', logos);
    if (!ok) setStatus('Logo library is full in this browser. Remove a few logos.', 'error');
    refreshLogoImages();
  }
  function refreshLogoImages() {
    logoImages.clear();
    for (const l of logos) {
      const img = new Image();
      img.onload = () => redraw();
      img.src = l.mode === 'badge' ? l.badge : l.glyph;
      logoImages.set(l.id, { img, mode: l.mode });
    }
  }
  // Logos are kept in groups (Highways, Schools…) and sorted A–Z, with
  // numbers in order (I-20 before I-635).
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  function logoGroupNames() {
    return [...new Set(['Highways', 'Schools', 'Water', 'Parks', 'Amenities', 'Shopping', ...logos.map(l => l.group).filter(Boolean)])].sort(byName);
  }
  function logoGroupsSorted(filter = '') {
    const f = filter.trim().toLowerCase();
    const m = new Map();
    for (const l of logos) {
      if (f && !(l.name + ' ' + (l.group || '')).toLowerCase().includes(f)) continue;
      const g = l.group || 'Other';
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(l);
    }
    for (const ls of m.values()) ls.sort((a, b) => byName(a.name, b.name));
    return [...m.entries()].sort((a, b) => (a[0] === 'Other') - (b[0] === 'Other') || byName(a[0], b[0]));
  }
  const GROUP_FOR_CAT = { public_school: 'Schools', private_school: 'Schools', charter_school: 'Schools', preschool: 'Schools',
    highway: 'Highways', lake: 'Water', pond: 'Water', park: 'Parks', amenity: 'Amenities', shopping: 'Shopping',
    attraction: 'Landmarks', golf: 'Golf', college: 'Colleges', hospital: 'Hospitals',
    skyline: 'Landmarks', airport: 'Airports', business: 'Landmarks', trail: 'Parks', marina: 'Water',
    church: 'Churches', library: 'Civic', civic: 'Civic' };

  const pickCtx = (p) => ({ name: p.title ?? p.name, group: GROUP_FOR_CAT[p.cat] });

  // Remember your edits to map places (logo/icon and renamed text), so the
  // next job near them (I-35E, Marcus High, a renamed community pool…)
  // starts the same way.
  let placeMem = {};       // place id -> { icon?, title? }
  let myPlaces = [];       // places you added yourself and saved for future jobs
  function rememberIcon() { syncMemory(); }
  function syncMemory() {
    let changed = false;
    for (const p of Object.values(S.places)) {
      if (p.source !== 'osm') continue;
      const cat = catById(p.cat);
      const want = {};
      if (p.icon && !(cat && p.icon === cat.icon)) want.icon = p.icon;
      if (p.title != null && p.title.trim() && p.title !== p.name) want.title = p.title;
      const had = JSON.stringify(placeMem[p.id] || {});
      if (had === JSON.stringify(want)) continue;
      if (Object.keys(want).length) placeMem[p.id] = want; else delete placeMem[p.id];
      changed = true;
    }
    if (changed) SV.store.save('placeMemory', placeMem);
    // Saved places: keep the library in step with edits made in this job.
    let mineChanged = false;
    for (const p of Object.values(S.places)) {
      if (p.source !== 'mine') continue;
      const rec = { id: p.id, name: p.title ?? p.name, lat: p.lat, lon: p.lon, cat: p.cat,
        ...(p.icon ? { icon: p.icon } : {}), ...(p.iconColor ? { iconColor: p.iconColor } : {}) };
      const i = myPlaces.findIndex(x => x.id === p.id);
      if (i >= 0 && JSON.stringify(myPlaces[i]) === JSON.stringify(rec)) continue;
      if (i >= 0) myPlaces[i] = rec; else myPlaces.push(rec);
      mineChanged = true;
    }
    if (mineChanged) SV.store.save('myPlaces', myPlaces);
  }
  function applyRememberedIcons() {
    for (const p of Object.values(S.places)) {
      const m = placeMem[p.id];
      if (!m) continue;
      if (m.icon && !p.icon && !(m.icon.startsWith('logo:') && !logos.find(l => l.id === m.icon.slice(5)))) p.icon = m.icon;
      if (m.title && p.title == null) p.title = m.title;
    }
  }
  // Bring your saved places near this house into the job.
  function mergeMyPlaces() {
    if (!S.house) return;
    for (const m of myPlaces) {
      const d = PJ.distM(S.house.lat, S.house.lon, m.lat, m.lon) / MI;
      if (d > 15) continue;
      const c = catById(m.cat);
      if (c && c.used === false) { c.used = true; c.enabled = true; placeTypes[c.id] = { ...(placeTypes[c.id] || {}), used: true }; SV.store.save('placeTypes', placeTypes); }
      const old = S.places[m.id];
      S.places[m.id] = { ...(old || { enabled: true }), id: m.id, source: 'mine', name: m.name, title: old ? old.title ?? m.name : m.name,
        lat: m.lat, lon: m.lon, cat: catById(m.cat) ? m.cat : 'custom', distMi: d, route: { lat: m.lat, lon: m.lon },
        ...(m.icon && !(old && old.icon) ? { icon: m.icon } : {}), ...(m.iconColor && !(old && old.iconColor) ? { iconColor: m.iconColor } : {}) };
    }
  }
  function saveToMyPlaces(p) {
    p.source = 'mine';
    p.name = p.title ?? p.name;
    p.route = { lat: p.lat, lon: p.lon };
    syncMemory();
  }
  function removeFromMyPlaces(id) {
    myPlaces = myPlaces.filter(x => x.id !== id);
    SV.store.save('myPlaces', myPlaces);
  }

  async function uploadLogos(files, defaults = {}) {
    const added = [];
    for (const f of files) {
      try {
        const l = await DT.logos.processLogo(f);
        if (defaults.group) l.group = defaults.group;
        if (defaults.name && files.length === 1) l.name = defaults.name;
        logos.push(l); added.push(l);
      }
      catch (e) { setStatus('Couldn’t read ' + f.name, 'error'); }
    }
    await saveLogos();
    return added;
  }

  let pickCallback = null, pickContext = {};
  function renderLogoGrid(current) {
    const groups = logoGroupsSorted($('#logoFilter').value);
    $('#logoGrid').innerHTML = groups.map(([g, ls]) => `<div class="logo-group-h">${esc(g)}</div>` + ls.map(l =>
      `<button type="button" class="pick ${current === 'logo:' + l.id ? 'cur' : ''}" data-icon="logo:${l.id}" title="${esc(l.name)}">${iconHtml('logo:' + l.id, '#57606a')}<span>${esc(l.name)}</span></button>`).join('')).join('')
      || `<p class="hint">${logos.length ? 'No logos match.' : 'No logos yet. Upload one below.'}</p>`;
  }
  function openIconPicker(current, cb, context = {}) {
    pickCallback = cb; pickContext = context;
    $('#logoFilter').value = '';
    $('#logoFilter').hidden = logos.length < 8;
    $('#iconGrid').innerHTML = Object.entries(IC.ICONS).map(([k, v]) =>
      `<button type="button" class="pick ${current === k ? 'cur' : ''}" data-icon="${k}" title="${esc(v.label)}">${iconHtml(k, '#57606a')}<span>${esc(v.label)}</span></button>`).join('');
    renderLogoGrid(current);
    $('#logoGrid').dataset.current = current || '';
    $('#iconDlg').showModal();
  }
  $('#logoFilter').addEventListener('input', () => renderLogoGrid($('#logoGrid').dataset.current));
  $('#iconDlg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    $('#iconDlg').close();
    if (pickCallback) pickCallback(b.dataset.icon);
  });
  $('#logoInput').addEventListener('change', async (e) => {
    const added = await uploadLogos(e.target.files, pickContext);
    e.target.value = '';
    if (added.length) { $('#iconDlg').close(); if (pickCallback) pickCallback('logo:' + added[0].id); }
  });

  // ---------------- Filmstrip & banner ----------------
  function renderFilmstrip() {
    const el = $('#filmstrip');
    el.hidden = S.photos.length < 1;
    el.innerHTML = S.photos.map((p, i) => {
      const a = assets.get(p.name);
      const warn = p.ground ? '<span class="eye-dot" title="Eye-level photo: places are added by hand">eye</span>'
        : !p.meta.hasDirection ? '<span class="warn-dot" title="No camera-direction data">!</span>' : '';
      return `<button class="thumb ${i === cur ? 'cur' : ''}" data-i="${i}" title="${esc(p.name)}">
        ${a ? `<img src="${a.url}" alt="">` : '<span class="missing">not loaded</span>'}
        <span class="num">${String(i + 1).padStart(2, '0')}</span>${warn}
        <span class="x" data-remove="${i}" title="Remove this photo (⌘Z to undo)">✕</span></button>`;
    }).join('');
  }
  $('#filmstrip').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { e.stopPropagation(); removePhoto(+rm.dataset.remove); return; }
    const b = e.target.closest('.thumb');
    if (!b) return;
    cur = +b.dataset.i;
    if (sel && sel.kind === 'house') sel = null;
    renderAll();
  });

  function renderBanner() {
    const el = $('#banner');
    const ph = photo();
    const missing = S.photos.filter(p => !p.ground && !p.meta.hasDirection);
    const notLoaded = S.photos.filter(p => !assets.has(p.name));
    let html = '';
    if (ph && !assets.has(ph.name)) {
      html = `Add the original photo files for this project with <b>Add photos</b>: ${notLoaded.map(p => esc(p.name)).join(', ')}`;
    } else if (ph && ph.ground) {
      const looksDji = ph.meta.hasDjiXmp || /dji/i.test(ph.meta.make || '');
      html = `<b>Eye-level photo.</b> Nothing is placed automatically. In <b>This photo</b> view, tick the places you want, then drag each dot and box into position (or use <b>+ Add a callout</b>).
        ${looksDji ? ' This looks like a drone photo whose camera data was removed on export (Lightroom: Metadata → All Metadata).' : ''}
        <a href="#" data-act-banner="make-drone">It’s a drone photo: line it up by hand</a>`;
    } else if (ph && !ph.meta.hasDirection) {
      html = `<b>⚠ This photo has no DJI camera-direction data</b>, so callouts can’t be placed automatically${missing.length > 1 ? ` (${missing.length} photos affected)` : ''}.
        In Lightroom’s Export window, set <b>Metadata → Include: All Metadata</b> and untick <b>Remove Location Info</b>, then re-export.
        Meanwhile, use the <a href="#" data-goto="camera">Camera tab</a> to line things up by hand.`;
    } else if (notLoaded.length) {
      html = `Add the original photo files for this project: ${notLoaded.map(p => esc(p.name)).join(', ')}`;
    } else if (ph && !S.house) {
      html = 'Enter the property address on the left and click <b>Find places</b>.';
    }
    el.hidden = !html;
    el.className = 'banner ' + (ph && !ph.ground && !ph.meta.hasDirection ? 'warn' : '');
    el.innerHTML = html;
  }
  $('#banner').addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { e.preventDefault(); setTab(g.dataset.goto); }
    const m = e.target.closest('[data-act-banner="make-drone"]');
    if (m && photo()) { e.preventDefault(); const ph = photo(); ph.ground = false; ph.adj.manual = true; commit(); setTab('camera'); renderAll(); }
  });

  // ---------------- Global controls ----------------
  function syncGlobalControls() {
    $('#address').value = S.address || '';
    $('#master').value = S.master;
    $('#masterOut').textContent = S.master + ' mi';
    $('#showDrive').checked = !!S.style.showDrive;
    $('#driveMode').value = S.style.driveMode;
  }
  $('#master').addEventListener('input', (e) => {
    S.master = parseFloat(e.target.value);
    $('#masterOut').textContent = S.master + ' mi';
    for (const c of S.categories) if (c.id !== 'custom' && !c.rangeMax) c.maxMi = S.master; // skylines & airports keep their own long distances
    redraw();
    renderSidebar();
  });
  $('#master').addEventListener('change', () => { commit(); maybeRefetch(); renderAll(); });
  $('#showDrive').addEventListener('change', (e) => { S.style.showDrive = e.target.checked; for (const p of Object.values(S.places)) delete p.driveFailed; commit(); renderAll(); });
  $('#driveMode').addEventListener('change', (e) => { S.style.driveMode = e.target.value; commit(); renderAll(); });
  $('#btnFind').addEventListener('click', findPlaces);
  $('#address').addEventListener('keydown', (e) => { if (e.key === 'Enter') findPlaces(); });
  $('#address').addEventListener('change', (e) => { S.address = e.target.value.trim(); });
  $('#btnAddCustom').addEventListener('click', startAddCustom);
  $('#btnAddCat').addEventListener('click', () => {
    const id = 'cat_' + Date.now().toString(36);
    S.categories.splice(S.categories.length - 1, 0, { id, name: 'New category', icon: 'star', color: '#6e7781', enabled: true, maxMi: 50, group: null, user: true, open: true });
    commit();
    select({ kind: 'cat', id });
  });
  $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnNew').addEventListener('click', newJob);

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (typing) return;
    if (mode === 'mask' && maskEd) {
      if (e.key === ' ') { spaceHeld = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
      if (e.key === 'Escape') { if (maskEd.poly.length) { maskEd.poly = []; redraw(); } else endMode(); return; }
      if (e.key === 'Enter') { maskClosePoly(); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && maskEd.poly.length) { e.preventDefault(); maskEd.poly.pop(); redraw(); return; }
      const tk = { s: 'smart', b: 'brush', r: 'box', l: 'line' }[e.key.toLowerCase()];
      if (tk && !mod) { setMaskTool(tk); return; }
      if (e.key.toLowerCase() === 'x' && !mod) { maskEd.kind = maskEd.kind === 'off' ? 'on' : 'off'; renderMaskBar(); redraw(); return; }
      if (e.key === '[' || e.key === ']') { maskEd.size = Math.max(4, Math.min(160, Math.round(maskEd.size * (e.key === ']' ? 1.25 : 0.8)))); renderMaskBar(); redraw(); return; }
      if (e.key === 'Alt' || e.key === 'Shift') { maskEd.alt = e.altKey; if (maskEd.preview) maskEd.preview.op = maskOp(e); redraw(); }
      return;
    }
    if (e.key === 'Escape') { if (mode) { drawPts = []; endMode(); redraw(); } else select(null); return; }
    if (e.key === 'Enter' && mode === 'drawLot') { finishLot(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'drawLot') { e.preventDefault(); drawPts.pop(); redraw(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.kind === 'lot' && (sel.vertex != null || sel.edge != null)) {
      e.preventDefault();
      sel.vertex != null ? deleteLotCorner(sel.vertex) : toggleLotSide(sel.edge);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.kind === 'place') {
      e.preventDefault();
      const p = S.places[sel.id];
      if (sideView === 'photo' && photo()) setShownOn(p, photo(), false); else p.enabled = false;
      commit();
      renderAll();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceHeld = false; if (mode === 'mask') canvas.style.cursor = 'crosshair'; }
    if (mode === 'mask' && maskEd && (e.key === 'Alt' || e.key === 'Shift')) { maskEd.alt = e.altKey; if (maskEd.preview) maskEd.preview.op = maskOp(e); redraw(); }
  });

  // ---------------- Save / open project ----------------
  function street() {
    return (S.address || 'Pinpoint').split(',')[0].replace(/[\\/:*?"<>|]+/g, '').trim() || 'Pinpoint';
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // "Save as" windows (Chrome and Edge). The window has to open right after
  // the click, so it's asked for before the photo is rendered. Other
  // browsers (Safari) fall back to the Downloads folder.
  const canPick = typeof window.showSaveFilePicker === 'function' && window.self === window.top;
  const isCancel = (e) => e && e.name === 'AbortError';
  async function pickFile(name, kind) {
    if (!canPick) return null;
    const types = kind === 'json' ? [{ description: 'Pinpoint project', accept: { 'application/json': ['.json'] } }]
      : kind === 'zip' ? [{ description: 'Zip file', accept: { 'application/zip': ['.zip'] } }]
      : [{ description: 'JPEG photo', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }];
    return window.showSaveFilePicker({ suggestedName: name, types, id: kind === 'json' ? 'pinpoint-project' : 'pinpoint-export', startIn: 'pictures' });
  }
  async function pickFolder() {
    if (typeof window.showDirectoryPicker !== 'function' || window.self !== window.top) return null;
    return window.showDirectoryPicker({ id: 'pinpoint-export', mode: 'readwrite', startIn: 'pictures' });
  }
  async function writeTo(handle, blob) {
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
  }
  const round6 = (n) => Math.round(n * 1e6) / 1e6;
  $('#btnSave').addEventListener('click', async () => {
    const name = `${street()} - Pinpoint project.json`;
    let fh = null;
    try { fh = await pickFile(name, 'json'); } catch (e) { if (isCancel(e)) return; }
    const g = {};
    for (const [id, v] of geom) {
      const step = Math.max(1, Math.ceil(v.samples.length / 600));
      g[id] = { kind: v.kind, centroid: v.centroid.map(round6), samples: v.samples.filter((_, i) => i % step === 0).map(p => [round6(p[0]), round6(p[1])]) };
    }
    const data = { app: 'drone-tag', version: 1, savedAt: new Date().toISOString(), state: S, geom: g };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    if (fh) {
      try { await writeTo(fh, blob); setStatus(`Project saved as “${fh.name}”. Open it later with Open, then add the same photos.`, 'ok'); }
      catch (e) { setStatus('Saving failed: ' + e.message, 'error'); }
      return;
    }
    download(blob, name);
    setStatus('Project saved to your Downloads. Open it later with Open, then add the same photos.', 'ok');
  });
  async function openProject(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'drone-tag' || !data.state) throw new Error('This isn’t a Pinpoint project file.');
      if (jobBusy()) throw new Error('a property is still loading, try again in a moment');
      // Opens as its own property tab (or into the blank one).
      stashJob();
      if (S.photos.length || S.house) { jobs.push(makeJob(data.state)); loadJob(jobs.length - 1); }
      else { jobs[ji] = makeJob(data.state); loadJob(ji); }
      S = data.state;
      S.addrState = S.house ? 'ok' : null;
      S.style = { ...clone(DEFAULT_STYLE), ...S.style };
      migrate();
      applyPlaceTypes();
      geom.clear();
      for (const [id, v] of Object.entries(data.geom || {})) geom.set(id, v);
      cur = 0; sel = null;
      syncGlobalControls();
      resetHistory();
      ensureFont().then(renderAll);
      const missing = S.photos.filter(p => !assets.has(p.name)).length;
      setStatus(missing ? `Project opened. Now add its ${missing} photo${missing > 1 ? 's' : ''} with Add photos.` : 'Project opened.', 'ok');
    } catch (e) {
      setStatus('Couldn’t open project: ' + e.message, 'error');
    }
  }
  $('#projectInput').addEventListener('change', (e) => { if (e.target.files[0]) openProject(e.target.files[0]); e.target.value = ''; });

  // ---------------- Export ----------------
  async function ensureFont() {
    try { await document.fonts.load(`${S.style.fontWeight} 40px "${S.style.font}"`); await document.fonts.load(`500 40px "${S.style.font}"`); } catch (e) { /* ignore */ }
  }
  // The photo's own file name plus "callout", e.g. "7 Main St 0268 callout.jpg".
  function exportName(i) {
    const ph = S.photos[i];
    const base = ph && ph.name ? ph.name.split('/').pop().replace(/\.[^.]+$/, '') : `${street()} ${String(i + 1).padStart(2, '0')}`;
    return `${base} callout.jpg`;
  }

  async function renderExport(i) {
    const ph = S.photos[i];
    const a = assets.get(ph.name);
    if (!a) throw new Error(ph.name + ' is not loaded');
    await ensureFont();
    const full = await createImageBitmap(a.file);
    const c = document.createElement('canvas');
    c.width = ph.W; c.height = ph.H;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    const lotMask = ph.lotMask ? await DT.mask.load(ph.lotMask).catch(() => null) : null;
    RD.drawScene(x, buildScene(i), full, { logoImages, lotMask, lotMaskVer: 'export' });
    full.close && full.close();
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.93));
    c.width = c.height = 0;
    return blob;
  }
  $('#btnExport').addEventListener('click', async () => {
    if (!photo()) return;
    const i = cur;
    let fh = null;
    try { fh = await pickFile(exportName(i), 'jpg'); } catch (e) { if (isCancel(e)) return; }
    busy('Creating full-resolution JPG…');
    try {
      const blob = await renderExport(i);
      if (fh) { await writeTo(fh, blob); setStatus(`Saved “${fh.name}”.`, 'ok'); }
      else { download(blob, exportName(i)); setStatus('Exported ' + exportName(i) + ' to Downloads.', 'ok'); }
    }
    catch (e) { setStatus('Export failed: ' + e.message, 'error'); }
    finally { busy(null); }
  });
  $('#btnExportAll').addEventListener('click', async () => {
    const ready = S.photos.map((p, i) => i).filter(i => assets.has(S.photos[i].name));
    if (!ready.length) return;
    // Pick where first: one photo → a Save window; several → a folder, and
    // each photo is saved into it as its own JPG.
    let fh = null, dir = null;
    try {
      if (ready.length === 1) fh = await pickFile(exportName(ready[0]), 'jpg');
      else dir = await pickFolder();
    } catch (e) { if (isCancel(e)) return; }
    if (dir) {
      try {
        const names = ready.map(exportName);
        const exists = [];
        for (const n of names) { try { await dir.getFileHandle(n); exists.push(n); } catch (_) {} }
        if (exists.length && !confirm(`${exists.length} of these photos ${exists.length > 1 ? 'are' : 'is'} already in “${dir.name}”. Replace ${exists.length > 1 ? 'them' : 'it'}?`)) return;
        for (let k = 0; k < ready.length; k++) {
          busy(`Saving photo ${k + 1} of ${ready.length}…`);
          await writeTo(await dir.getFileHandle(names[k], { create: true }), await renderExport(ready[k]));
        }
        setStatus(`Saved ${ready.length} photos to the “${dir.name}” folder.`, 'ok');
      } catch (e) { setStatus('Export failed: ' + e.message, 'error'); }
      finally { busy(null); }
      return;
    }
    try {
      if (ready.length === 1) {
        busy('Creating full-resolution JPG…');
        const blob = await renderExport(ready[0]);
        if (fh) await writeTo(fh, blob); else download(blob, exportName(ready[0]));
      }
      else {
        const zip = new JSZip();
        for (let k = 0; k < ready.length; k++) {
          busy(`Creating photo ${k + 1} of ${ready.length}…`);
          zip.file(exportName(ready[k]), await renderExport(ready[k]));
        }
        busy('Packing zip file…');
        download(await zip.generateAsync({ type: 'blob' }), `${street()} - callouts.zip`);
      }
      setStatus(`Exported ${ready.length} photo${ready.length > 1 ? 's' : ''}.`, 'ok');
    } catch (e) { setStatus('Export failed: ' + e.message, 'error'); }
    finally { busy(null); }
  });

  // ---------------- Drag & drop ----------------
  window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  // Folders can be dropped too: each folder's name (e.g. “123 Main St”)
  // tells the app which property its photos belong to.
  async function readDropped(dt) {
    const files = [], folders = new Map();
    const entries = [...(dt.items || [])].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return { files: [...dt.files], folders };
    const fileOf = (en) => new Promise((res, rej) => en.file(res, rej));
    const readAll = (dir) => new Promise((res) => {
      const r = dir.createReader(), out = [];
      const next = () => r.readEntries((batch) => { if (!batch.length) res(out); else { out.push(...batch); next(); } }, () => res(out));
      next();
    });
    // A folder counts as one property if it's a subfolder of what you dropped,
    // or if you dropped several folders side by side.
    const manyDirs = entries.filter(en => en.isDirectory).length > 1;
    async function walk(en, folder, depth) {
      if (en.isFile) { const f = await fileOf(en); files.push(f); if (folder) folders.set(f, { name: folder, sub: depth >= 2 || manyDirs }); return; }
      if (depth > 4 || /^callouts$/i.test(en.name)) return; // skip finished exports
      for (const c of await readAll(en)) await walk(c, en.name, depth + 1);
    }
    for (const en of entries) await walk(en, null, 0);
    return { files, folders };
  }
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('dropping');
    const { files, folders } = await readDropped(e.dataTransfer);
    const proj = files.find(f => /\.json$/i.test(f.name));
    if (proj) await openProject(proj);
    const imgs = files.filter(f => /\.jpe?g$/i.test(f.name));
    if (imgs.length) addFiles(imgs, folders);
  });
  $('#folderInput').addEventListener('change', (e) => {
    const folders = new Map();
    for (const f of e.target.files) {
      const parts = (f.webkitRelativePath || '').split('/');
      if (parts.length > 2 && /^callouts$/i.test(parts[parts.length - 2])) continue;
      if (parts.length >= 2) folders.set(f, { name: parts[parts.length - 2], sub: parts.length >= 3 });
    }
    const imgs = [...e.target.files].filter(f => /\.jpe?g$/i.test(f.name) && !/\/callouts\//i.test(f.webkitRelativePath || ''));
    addFiles(imgs, folders);
    e.target.value = '';
  });
  new ResizeObserver(() => redraw()).observe($('#canvasWrap'));

  // For checking things from the browser console.
  DT.debug = { addressFromName, normAddr, get jobs() { return jobs; }, get S() { return S; }, get ji() { return ji; }, get scene() { return scene; }, buildScene, camFor };

  // ---------------- Start ----------------
  (async function init() {
    await loadLogos();
    placeTypes = await SV.store.load('placeTypes', {}) || {};
    catOrder = await SV.store.load('catOrder', []) || [];
    placeMem = await SV.store.load('placeMemory', null);
    if (!placeMem) { // older versions only remembered icons
      placeMem = {};
      for (const [id, icon] of Object.entries(await SV.store.load('placeIcons', {}) || {})) placeMem[id] = { icon };
    }
    myPlaces = await SV.store.load('myPlaces', []) || [];
    // Merged categories: carry over which types you use, and your own places.
    {
      let typesChanged = false, mineChanged = false;
      for (const [from, to] of Object.entries(MERGED_INTO)) {
        const t = placeTypes[from];
        if (!t) continue;
        if (t.used) placeTypes[to] = { ...(placeTypes[to] || {}), used: true };
        delete placeTypes[from];
        typesChanged = true;
      }
      for (const m of myPlaces) if (MERGED_INTO[m.cat]) { m.cat = MERGED_INTO[m.cat]; mineChanged = true; }
      if (typesChanged) SV.store.save('placeTypes', placeTypes);
      if (mineChanged) SV.store.save('myPlaces', myPlaces);
    }
    cameraPrefs = await SV.store.load('cameraPrefs2', {}) || {};
    applyPlaceTypes();
    const d = await SV.store.load('defaultPreset', null);
    defaultPresetCache = d;
    jobs = [makeJob()];
    loadJob(0);
    syncGlobalControls();
    resetHistory();
    renderAll();
    setStatus('');
    document.fonts.ready.then(redraw);
    ensureFont().then(redraw);
  })();

  // Exposed for testing in the browser console.
  DT.app = { get state() { return S; }, addFiles, findPlaces, buildScene, renderAll, setTab, select, renderExport, commit };
})(window.DT = window.DT || {});
