// Place data. A "provider" finds places near the house. OpenStreetMap is the
// first provider; Google Places can be added later as another provider that
// returns places in the same shape.
(function (DT) {
  const P = () => DT.projection;
  const MI = 1609.344;

  const DEFAULT_CATEGORIES = [
    { id: 'public_school',  name: 'Public schools',        icon: 'school',  color: '#1f6feb', enabled: true,  maxMi: 2,  group: 'school' },
    { id: 'private_school', name: 'Private schools',       icon: 'school',  color: '#8250df', enabled: true,  maxMi: 2,  group: 'school' },
    { id: 'charter_school', name: 'Charter schools',       icon: 'school',  color: '#bf3989', enabled: true,  maxMi: 2,  group: 'school' },
    { id: 'preschool',      name: 'Preschools & daycares', icon: 'child',   color: '#b08800', enabled: false, maxMi: 1,  group: 'school' },
    { id: 'highway',        name: 'Major highways',        icon: 'highway', color: '#cf222e', enabled: true,  maxMi: 8,  group: 'highway',
      roadTypes: { interstate: true, us: true, state: true, toll: true, loop: false, other: false, fm: false, county: false } },
    { id: 'lake',           name: 'Lakes & rivers',        icon: 'water',   color: '#0a7ea4', enabled: true,  maxMi: 8,  group: 'water', minAcres: 250 },
    { id: 'pond',           name: 'Ponds & small lakes',   icon: 'water',   color: '#3192aa', enabled: true,  maxMi: 1,  group: 'water' },
    { id: 'park',           name: 'Parks',                 icon: 'park',    color: '#1a7f37', enabled: true,  maxMi: 1,  group: 'park' },
    { id: 'amenity',        name: 'Neighborhood amenities', icon: 'pool',  color: '#0e8a7e', enabled: true,  maxMi: 1,  group: 'amenity' },
    { id: 'attraction',     name: 'Attractions & landmarks', icon: 'landmark', color: '#a0522d', enabled: true, maxMi: 8, group: 'attraction' },
    { id: 'golf',           name: 'Golf courses & marinas', icon: 'golf',   color: '#2da44e', enabled: true,  maxMi: 5,  group: 'attraction', alsoGroups: ['extra'] },
    { id: 'college',        name: 'Colleges & universities', icon: 'school', color: '#0550ae', enabled: true, maxMi: 8,  group: 'attraction' },
    { id: 'hospital',       name: 'Hospitals',             icon: 'hospital', color: '#d1242f', enabled: true, maxMi: 5,  group: 'attraction' },
    { id: 'skyline',        name: 'Downtown skylines',     icon: 'skyline', color: '#475569', enabled: true,  maxMi: 30, rangeMax: 50, group: 'landmark' },
    { id: 'airport',        name: 'Airports',              icon: 'plane',   color: '#0969da', enabled: true,  maxMi: 20, rangeMax: 50, group: 'landmark' },
    { id: 'trail',          name: 'Trails & greenbelts',   icon: 'trail',   color: '#4d7c0f', enabled: true,  maxMi: 2,  group: 'extra' },
    { id: 'church',         name: 'Churches & places of worship', icon: 'church', color: '#7c3aed', enabled: true, maxMi: 2, group: 'extra' },
    { id: 'civic',          name: 'Libraries & city buildings', icon: 'landmark', color: '#334155', enabled: true, maxMi: 5, group: 'extra' },
    { id: 'shopping',       name: 'Shopping & business hubs', icon: 'shop', color: '#bc4c00', enabled: true,  maxMi: 4,  group: 'shop', majorOnly: true },
    { id: 'custom',         name: 'My callouts',           icon: 'star',    color: '#57606a', enabled: true,  maxMi: 50, group: null },
  ];
  // Place types you don't use are hidden from the sidebar and never searched.
  // Change them in "Choose place types".
  const DEFAULT_UNUSED = ['preschool', 'pond', 'amenity', 'shopping', 'golf', 'college', 'hospital',
    'skyline', 'airport', 'trail', 'church', 'civic'];
  // Kinds of places that share a category, with their own icon, e.g. libraries
  // sit in "Libraries & city buildings" but keep the book icon.
  // [category, icon, reach in miles that ignores the category slider]
  const MERGED = { library: ['civic', 'book'], marina: ['golf', 'boat'], business: ['shopping', 'building', 15] };
  for (const c of DEFAULT_CATEGORIES) c.used = !DEFAULT_UNUSED.includes(c.id);

  const ROAD_TYPES = [
    ['interstate', 'Interstates (I-35E, I-635…)'],
    ['us', 'US highways (US 75, US 377…)'],
    ['state', 'State highways (SH 114, SH 121…)'],
    ['toll', 'Tollways (Sam Rayburn, George Bush, DNT…)'],
    ['loop', 'Loops & spurs (Loop 12, Spur 408…)'],
    ['fm', 'Farm-to-Market roads (FM 2499, FM 407…)'],
    ['other', 'Other named freeways (International Pkwy…)'],
    ['county', 'County roads'],
  ];
  function roadType(label, t) {
    const s = label || '';
    if (/^I-/.test(s)) return 'interstate';
    if (/^US\b/i.test(s)) return 'us';
    if (/toll|turnpike|chisholm trail|^(DNT|SRT|PGBT|CTP)\b/i.test(s)) return 'toll';
    if (/^(FM|RM|Farm|Ranch)\b/i.test(s)) return 'fm';
    if (/^(CR|County)\b/i.test(s)) return 'county';
    if (/^(Loop|SL|Spur|Bus|Business)\b/i.test(s)) return 'loop';
    if (/^(SH|TX|State|SR)\b/i.test(s)) return 'state';
    return t.highway === 'motorway' || t.highway === 'trunk' ? 'other' : null;
  }

  // Well-known Texas charter networks (OSM rarely marks charters).
  const CHARTER_RE = /charter|responsive ?ed|founders classical|harmony (science|school)|\bidea (public|college)|great hearts|uplift|\bkipp\b|leadership prep|international leadership of texas|\bbasis\b|legacy prep|imagine international|trivium|westlake academy|life school|premier high|texas college prep|valor|treetops|newman international|a\+ academy|golden rule/i;
  const PRESCHOOL_RE = /daycare|day care|learning cent(er|re)|early childhood|child ?care|pre-?school|pre-?k\b|kids|primrose|kindercare|goddard|lightbridge|childrens? (world|courtyard|lighthouse)|children's (world|courtyard|lighthouse)|tutoring|kumon|mathnasium|nursery/i;
  const NOT_SCHOOL_RE = /faculty|services? cent|administration|athletic|stadium|transportation|enrichment cent|natatorium|maintenance/i;
  const PRIVATE_NAME_RE = /academy|montessori|christian|catholic|lutheran|episcopal|baptist|methodist|presbyterian|\bst\.? |saint|day school|parish|yeshiva|islamic|hebrew|torah|prep\b|preparatory|private/i;

  // Rec centers, YMCAs, aquatic centers (not gyms or private businesses).
  const AMENITY_RE = /recreation|\brec\b|ymca|aquatic|community|amenity|clubhouse|natatorium/i;
  // Neighborhood pools are rarely named in OpenStreetMap, so they're found by
  // size: backyard pools are under ~110 m², community pools 170 m² and up.
  const MIN_COMMUNITY_POOL_M2 = 150;

  function classifySchool(t) {
    const name = t.name || '';
    const op = [t.operator, t['operator:type'], t['school:type'], t.religion].filter(Boolean).join(' ');
    if (NOT_SCHOOL_RE.test(name)) return null;
    if (t.amenity === 'kindergarten' || t.amenity === 'childcare' || PRESCHOOL_RE.test(name)) return 'preschool';
    if (CHARTER_RE.test(name + ' ' + op)) return 'charter_school';
    if (/\bISD\b|independent school district|\bCISD\b/i.test(op)) return 'public_school';
    if (/private|religious|church/i.test(op) || PRIVATE_NAME_RE.test(name)) return 'private_school';
    if (/public/i.test(op)) return 'public_school';
    return 'public_school';
  }

  function highwayLabel(ref) {
    let r = String(ref).split(';')[0].trim();
    r = r.replace(/^I\s+(\d)/i, 'I-$1').replace(/^IH\s*(\d)/i, 'I-$1').replace(/^TX\s+/i, 'SH ');
    r = r.replace(/\s+(TEXP|Express|Managed|ML|HOV|Toll|Frontage)$/i, ''); // express lanes = same highway
    r = r.replace(/^SL\s+/i, 'Loop ').replace(/^FM\s*/i, 'FM ');
    const NAMES = { SRT: 'Sam Rayburn Tollway', PGBT: 'George Bush Turnpike', DNT: 'Dallas North Tollway', CTP: 'Chisholm Trail Pkwy' };
    return NAMES[r.toUpperCase()] || r;
  }

  // Museums, zoos, stadiums, theaters, botanical gardens, big shopping and
  // dining districts (e.g. a "River Walk" or "Town Square").
  const SCHOOL_VENUE_RE = /high school|middle school|elementary|\bISD\b|junior high|natatorium/i;
  // Big sports and event venues: pro and college stadiums, arenas, district
  // athletic complexes (e.g. CH Collins Athletic Complex in Denton).
  const VENUE_RE = /stadium|arena|athletic (complex|center|centre|park)|sports ?(complex|park|plex)|sportsplex|soccer (complex|park|center)|ballpark|field ?house|event cent(er|re)|speedway|coliseum|amphithea/i;
  const MIN_VENUE_M2 = 48000; // ~12 acres, unless it's well known (Wikidata)
  const isVenue = (t) => t.leisure === 'stadium' || t.leisure === 'sports_centre' || t.amenity === 'events_venue';
  function classifyAttraction(t) {
    const name = t.name || '';
    if (/^(path|cycleway|footway|bridleway)$/.test(t.highway)) return /trail|greenbelt|greenway/i.test(name) ? 'trail' : 'skip';
    if (t.leisure === 'marina' || t.leisure === 'slipway') return 'marina';
    if (!name) return null;
    if (t.amenity === 'place_of_worship') return 'church';
    if (t.amenity === 'library') return 'library';
    if (t.amenity === 'townhall') return 'civic';
    if (/^(university|college)$/.test(t.amenity)) return 'college';
    if (t.amenity === 'hospital') return 'hospital';
    if (t.leisure === 'golf_course') return 'golf';
    if (/^(museum|zoo|aquarium|theme_park)$/.test(t.tourism)) return 'attraction';
    if (t.tourism === 'attraction' && t.wikidata && t.leisure !== 'park') return 'attraction';
    // Stadiums, arenas, athletic complexes: well-known ones, or big ones
    // (size checked later). A single school's own field doesn't count.
    if (isVenue(t)) {
      if (SCHOOL_VENUE_RE.test(name + ' ' + (t.operator || ''))) return t.leisure === 'sports_centre' ? null : 'skip';
      if (t.leisure === 'sports_centre' && AMENITY_RE.test(name)) return null; // rec/aquatic center → neighborhood amenity
      if (t.wikidata) return 'attraction';
      if (t.leisure === 'stadium' || t.building === 'stadium' || VENUE_RE.test(name)) return 'attraction';
      return null;
    }
    if (/^(theatre|arts_centre)$/.test(t.amenity)) return SCHOOL_VENUE_RE.test(name) ? null : 'attraction';
    if (t.leisure === 'garden' && t['garden:type'] === 'botanical') return 'attraction';
    if (t.leisure === 'water_park') return 'attraction';
    if (t.landuse === 'retail') return 'attraction'; // big named districts only; size checked later
    return null;
  }

  function classify(t) {
    if (t.amenity === 'school' || t.amenity === 'kindergarten' || t.amenity === 'childcare') return classifySchool(t);
    const at = classifyAttraction(t);
    if (at) return at === 'skip' ? null : at;
    if (t.highway) return 'highway';
    if (t.natural === 'water' || t.waterway || t.water) return 'lake'; // lake vs pond decided by size later
    if (t.leisure === 'park') return 'park';
    if (/^(swimming_pool|water_park)$/.test(t.leisure) || /^(community_centre|clubhouse)$/.test(t.amenity) || t.building === 'clubhouse') return 'amenity';
    if (t.leisure === 'sports_centre' && AMENITY_RE.test(t.name || '')) return 'amenity';
    if (t.shop) return 'shopping';
    return null;
  }

  // Overpass (OpenStreetMap search) servers, tried in order.
  const OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  // Remember search results for 30 days (in this browser), so repeat jobs in
  // the same area are instant and don't depend on the busy free servers.
  const CACHE_DAYS = 30;
  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('drone-tag-cache', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('overpass');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function cacheGet(key) {
    try {
      const db = await idb();
      return await new Promise((res) => {
        const q = db.transaction('overpass').objectStore('overpass').get(key);
        q.onsuccess = () => res(q.result && Date.now() - q.result.t < CACHE_DAYS * 864e5 ? q.result.data : null);
        q.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }
  async function cachePut(key, data) {
    try {
      const db = await idb();
      db.transaction('overpass', 'readwrite').objectStore('overpass').put({ t: Date.now(), data }, key);
    } catch (e) { /* cache is optional */ }
  }
  async function overpassCached(query, onStatus, start) {
    const hit = await cacheGet(query);
    if (hit) return hit;
    const data = await overpass(query, onStatus, start);
    cachePut(query, data);
    return data;
  }

  async function overpass(query, onStatus, start = 0) {
    let lastErr;
    const order = [...OVERPASS.slice(start % OVERPASS.length), ...OVERPASS.slice(0, start % OVERPASS.length)];
    for (const url of [...order, order[0]]) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 80000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('timed out') : e;
        onStatus && onStatus();
      } finally { clearTimeout(timer); }
    }
    throw lastErr || new Error('No map server responded');
  }

  function ringArea(pts, lat0, lon0) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = P().enu(lat0, lon0, pts[i][0], pts[i][1]);
      const [x2, y2] = P().enu(lat0, lon0, pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]);
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a / 2);
  }

  function decimate(pts, max) {
    if (pts.length <= max) return pts;
    const step = pts.length / max, out = [];
    for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]);
    return out;
  }

  // Add extra points along long straight segments so we can tell when a
  // road or shoreline crosses the frame even with no corner points inside.
  function densify(lines, spacingM, maxPts) {
    const out = [];
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        out.push(line[i]);
        if (i + 1 < line.length) {
          const [a, b] = [line[i], line[i + 1]];
          const d = P().distM(a[0], a[1], b[0], b[1]);
          const n = Math.floor(d / spacingM);
          for (let k = 1; k <= n; k++) {
            const t = k / (n + 1);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
      }
    }
    return decimate(out, maxPts);
  }

  const MIN_WATER_M2 = 20000; // about 5 acres; skips tiny unnamed-looking ponds
  const ACRE = 4046.86;
  const GROUP_OF = { public_school: 'school', private_school: 'school', charter_school: 'school', preschool: 'school',
    highway: 'highway', lake: 'water', pond: 'water', park: 'park', amenity: 'amenity', shopping: 'shop',
    attraction: 'attraction', golf: 'attraction', college: 'attraction', hospital: 'attraction',
    skyline: 'landmark', airport: 'landmark', business: 'landmark',
    trail: 'extra', marina: 'extra', church: 'extra', library: 'extra', civic: 'extra' };
  // A named shopping/dining area must be ~12 acres to count as a landmark
  // (the River Walk Market in Flower Mound is 14.7).
  const MIN_DISTRICT_M2 = 48000;

  // Search OpenStreetMap. radii are in meters per group.
  // Search OpenStreetMap. radii are in meters per group. The search is split
  // into smaller pieces that run side by side on different servers, so one
  // slow piece doesn't hold up (or sink) the rest.
  async function searchOsm(opts, onStatus) {
    // Use the ready-made DFW data when it covers this search; ask the live
    // servers only for what it can't answer.
    const local = await searchLocal(opts, onStatus).catch((e) => { console.warn('Built-in data unavailable:', e.message); return null; });
    if (local && !local.missing.length) return local;
    const live = await searchLive({ ...opts, groups: local ? local.missing : opts.groups }, onStatus);
    if (!local) return live;
    return { places: [...local.places, ...live.places], ok: [...local.ok, ...live.ok], failed: live.failed, source: 'mixed', built: local.built };
  }

  // ---------- Ready-made DFW data (data/dfw, built by tools/build_dfw_data.py) ----------
  let manifestP = null;
  const tileCache = new Map();
  function loadManifest() {
    if (!manifestP) manifestP = fetch('data/dfw/manifest.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('no built-in data'); return r.json(); });
    return manifestP.catch((e) => { manifestP = null; throw e; });
  }
  function loadTile(group, key, version) {
    const k = group + '/' + key;
    // ?v= makes browsers fetch fresh files after each monthly refresh.
    if (!tileCache.has(k)) tileCache.set(k, fetch(`data/dfw/${k}.json?v=${version || ''}`).then(r => { if (!r.ok) throw new Error('missing tile ' + k); return r.json(); })
      .catch(e => { tileCache.delete(k); throw e; }));
    return tileCache.get(k);
  }
  function toOverpass(c) {
    const pt = (p) => ({ lat: p[0], lon: p[1] });
    if (c.t === 'n') return { type: 'node', id: c.i, lat: c.g[0][0], lon: c.g[0][1], tags: c.k };
    if (c.t === 'w') return { type: 'way', id: c.i, tags: c.k, geometry: c.g.map(pt) };
    return { type: 'relation', id: c.i, tags: c.k, members: c.m.map(g => ({ role: 'outer', geometry: g.map(pt) })) };
  }
  async function searchLocal({ lat, lon, radii, groups: wanted }, onStatus) {
    const m = await loadManifest();
    const [S, W, N, E] = m.bbox;
    const groups = wanted || Object.keys(m.groups);
    const elements = [], ok = [], missing = [];
    onStatus && onStatus('Loading built-in DFW map data…');
    for (const g of groups) {
      const r = radii[g] * 1.05;
      const [s] = P().offset(lat, lon, r, 180), [n] = P().offset(lat, lon, r, 0);
      const w = P().offset(lat, lon, r, 270)[1], e = P().offset(lat, lon, r, 90)[1];
      if (!m.groups[g] || s < S || n > N || w < W || e > E) { missing.push(g); continue; }
      const have = new Set(m.groups[g]), keys = [];
      for (let ri = Math.floor((s - S) / m.tile); ri <= Math.floor((n - S) / m.tile); ri++)
        for (let ci = Math.floor((w - W) / m.tile); ci <= Math.floor((e - W) / m.tile); ci++)
          if (have.has(ri + '_' + ci)) keys.push(ri + '_' + ci);
      try {
        const tiles = await Promise.all(keys.map(k => loadTile(g, k, m.version)));
        const seen = new Set();
        for (const t of tiles) for (const c of t.e) {
          const id = c.t + c.i;
          if (seen.has(id)) continue;
          seen.add(id);
          // Skip pieces entirely outside the search circle (cheap check on the outline).
          const pts = c.g || c.m.flat();
          let near = false;
          for (let i = 0; i < pts.length && !near; i++) near = P().distM(lat, lon, pts[i][0], pts[i][1]) <= r;
          if (near) elements.push(toOverpass(c));
        }
        ok.push(g);
      } catch (e) { missing.push(g); }
    }
    return { places: buildPlaces(elements, lat, lon, radii), ok, missing, failed: [], source: 'built-in', built: m.built };
  }

  // ---------- Live search on the free OpenStreetMap servers ----------
  // Same as ATTRACTION in tools/build_dfw_data.py.
  const ATTRACTION_Q = 'nwr{b}[tourism~"^(museum|zoo|aquarium|theme_park|attraction)$"][name];nwr{b}[leisure~"^(stadium|water_park|golf_course|sports_centre)$"][name];nwr{b}[amenity=events_venue][name];'
    + 'nwr{b}[leisure=garden]["garden:type"=botanical][name];nwr{b}[amenity~"^(theatre|arts_centre|university|college|hospital)$"][name];wr{b}[landuse=retail][name];';
  // Same as EXTRA in tools/build_dfw_data.py.
  const EXTRA_Q = 'way{b}[highway~"^(path|cycleway|footway|bridleway)$"][name~"trail|greenbelt|greenway",i];nwr{b}[leisure=marina];nwr{b}[leisure=slipway];'
    + 'nwr{b}[amenity~"^(place_of_worship|library|townhall)$"][name];';
  async function searchLive({ lat, lon, radii, groups: wanted }, onStatus) {
    const bbox = (r) => {
      const [s, w] = P().offset(lat, lon, r * Math.SQRT2, 225);
      const [n, e] = P().offset(lat, lon, r * Math.SQRT2, 45);
      return `(${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)})`;
    };
    const pieces = {
      school: `nwr${bbox(radii.school)}[amenity~"^(school|kindergarten|childcare)$"][name];`,
      park: `nwr${bbox(radii.park)}[leisure=park][name];`,
      highway: `way${bbox(radii.highway)}[highway~"^(motorway|trunk)$"];way${bbox(Math.min(radii.highway, 3 * MI))}[highway=primary][ref];`,
      water: `nwr${bbox(radii.water)}[natural=water][name];nwr${bbox(radii.water)}[waterway=river][name~"River"];`,
      amenity: `way${bbox(radii.amenity)}[leisure=swimming_pool];nwr${bbox(radii.amenity)}[leisure=water_park];nwr${bbox(radii.amenity)}[amenity~"^(community_centre|clubhouse)$"];nwr${bbox(radii.amenity)}[building=clubhouse];nwr${bbox(radii.amenity)}[leisure=sports_centre][name];`,
      attraction: ATTRACTION_Q.replace(/\{b\}/g, bbox(radii.attraction)),
      extra: EXTRA_Q.replace(/\{b\}/g, bbox(radii.extra)),
      shop: `nwr${bbox(radii.shop)}[shop~"^(supermarket|department_store|wholesale|mall|doityourself|hardware|electronics|furniture|sports)$"][name];`,
    };
    const jobs = [
      ['school', 'park', 'amenity'], ['highway'], ['water'], ['shop', 'attraction', 'extra'],
    ].map(gs => gs.filter(g => !wanted || wanted.includes(g))).filter(gs => gs.length);
    let done = 0;
    const report = () => onStatus && onStatus(`Searching OpenStreetMap… ${done} of ${jobs.length} done (servers can be slow; up to a minute)`);
    report();
    const results = await Promise.allSettled(jobs.map((gs, i) =>
      overpassCached(`[out:json][timeout:90];(${gs.map(g => pieces[g]).join('')});out geom;`, null, i)
        .finally(() => { done++; report(); })));
    const elements = [], failed = [], ok = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { elements.push(...(r.value.elements || [])); ok.push(...jobs[i]); }
      else failed.push(...jobs[i]);
    });
    if (!ok.length) throw results.find(r => r.status === 'rejected').reason;
    return { places: buildPlaces(elements, lat, lon, radii), ok, failed, source: 'live' };
  }

  function buildPlaces(elements, lat, lon, radii) {
    const groups = new Map();
    for (const el of elements) {
      const t = el.tags || {};
      const cat = classify(t);
      if (!cat) continue;

      let lines = [], kind = 'point';
      if (el.type === 'node') lines = [[[el.lat, el.lon]]];
      else if (el.type === 'way' && el.geometry) {
        const pts = el.geometry.map(g => [g.lat, g.lon]);
        lines = [pts];
        const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
        kind = (cat === 'highway' || t.waterway) ? 'line' : (closed ? 'area' : 'line');
      } else if (el.type === 'relation' && el.members) {
        for (const m of el.members) {
          if (m.geometry && (m.role === 'outer' || m.role === '' || m.role === 'main_stream')) lines.push(m.geometry.map(g => [g.lat, g.lon]));
        }
        kind = t.type === 'waterway' ? 'line' : 'area';
      }
      if (!lines.length || !lines[0].length) continue;

      let area = 0;
      if (kind === 'area') area = lines.reduce((s, l) => s + ringArea(decimate(l, 2000), lat, lon), 0);
      if (cat === 'lake' && kind === 'area' && area < (/creek|branch|ditch|canal|drain/i.test(t.name || '') ? 500000 : MIN_WATER_M2)) continue;
      if (cat === 'highway' && !t.ref && !t.name) continue;
      if (cat === 'attraction' && t.landuse === 'retail' && (kind !== 'area' || area < MIN_DISTRICT_M2 || /shopping cent(er|re)$/i.test(t.name || ''))) continue;
      if (cat === 'attraction' && isVenue(t) && !t.wikidata && (kind !== 'area' || area < MIN_VENUE_M2)) continue;
      if (cat === 'trail') kind = 'line';
      const isPool = t.leisure === 'swimming_pool';
      if (cat === 'amenity' && isPool && (kind !== 'area' || area < MIN_COMMUNITY_POOL_M2 || /^(customers|private)$/.test(t.access || '') && area < 250)) continue;
      if (cat === 'amenity' && !t.name && !isPool && t.building !== 'clubhouse' && t.amenity !== 'clubhouse') continue;
      if (!t.name && !t.ref && cat !== 'amenity' && cat !== 'marina') continue;

      const name = cat === 'highway' ? (t.ref ? highwayLabel(t.ref) : t.name)
        : t.name || (isPool ? 'Community pool' : cat === 'marina' ? (t.leisure === 'slipway' ? 'Boat ramp' : 'Marina') : 'Amenity center');
      const rtype = cat === 'highway' ? roadType(name, t) : null;
      if (cat === 'highway' && !rtype) continue;
      // Unnamed pools/clubhouses are kept apart instead of merged by name.
      const key = cat + '|' + name.toLowerCase() + (t.name || (cat !== 'amenity' && cat !== 'marina') ? '' : '|' + el.id);
      if (!groups.has(key)) {
        groups.set(key, {
          id: 'osm:' + key.replace(/[^a-z0-9|]+/g, '-'),
          source: 'osm', cat, name, kind, lines: [], area: 0,
          major: !!(t.brand || t['brand:wikidata']),
          osm: el.type + '/' + el.id,
          roadType: rtype, river: !!t.waterway,
          smallTag: /^(pond|basin|detention|retention|wastewater|reflecting_pool|fountain)$/.test(t.water || ''),
        });
      }
      const g = groups.get(key);
      g.lines.push(...lines.map(l => decimate(l, 3000)));
      g.area += area;
      if (kind === 'area' && g.kind !== 'area') g.kind = 'area';
      if (t.waterway) g.river = true;
      if (rtype && /^(motorway|trunk)$/.test(t.highway)) g.roadType = rtype; // main road wins over side pieces
      if (t.brand || t['brand:wikidata']) g.major = true;
    }

    const places = [];
    for (const g of groups.values()) {
      const all = g.lines.flat();
      let nearest = all[0], best = Infinity, sLat = 0, sLon = 0;
      for (const p of all) {
        const d = P().distM(lat, lon, p[0], p[1]);
        if (d < best) { best = d; nearest = p; }
        sLat += p[0]; sLon += p[1];
      }
      const centroid = [sLat / all.length, sLon / all.length];
      if (radii && best > (radii[GROUP_OF[g.cat]] || Infinity) * 1.05) continue; // outside the search circle
      // For highways and big lakes the closest point may be on a bridge or
      // across the water, so drive times are checked to several spread-out
      // nearby points and the quickest one is used.
      const routes = [{ lat: nearest[0], lon: nearest[1] }];
      if (g.kind !== 'point') {
        const sorted = all.map(p => [P().distM(lat, lon, p[0], p[1]), p]).sort((a, b) => a[0] - b[0]);
        for (const [d, p] of sorted) {
          if (routes.length >= 6 || d > best + 6000) break;
          if (routes.every(r => P().distM(r.lat, r.lon, p[0], p[1]) > 1200)) routes.push({ lat: p[0], lon: p[1] });
        }
      }
      const samples = g.kind === 'point' ? [all[0]] : densify(g.lines, g.kind === 'line' ? 80 : 60, 2500);
      const mg = MERGED[g.cat];
      places.push({
        place: {
          id: g.id, source: 'osm', cat: mg ? mg[0] : g.cat, name: g.name, ...(mg ? { kindIcon: mg[1] } : {}),
          lat: g.kind === 'point' ? all[0][0] : centroid[0],
          lon: g.kind === 'point' ? all[0][1] : centroid[1],
          distMi: best / MI, major: g.major,
          route: routes[0], routes,
          ...(g.cat === 'highway' ? { roadType: g.roadType } : {}),
          ...(g.cat === 'lake' ? { acres: g.river ? 1e6 : Math.round(g.area / ACRE), smallTag: g.smallTag && !g.river } : {}),
        },
        geom: { kind: g.kind, samples, centroid },
      });
    }
    return places;
  }

  // Where to put the callout dot for this place in this photo, or null if
  // no part of the place is visible.
  function anchorFor(place, geom, cam) {
    const { project, inFrame } = P();
    if (!geom || geom.kind === 'point') {
      const p = project(cam, place.lat, place.lon);
      return inFrame(cam, p) ? p : null;
    }
    if (geom.kind === 'area') {
      const c = project(cam, geom.centroid[0], geom.centroid[1]);
      if (inFrame(cam, c, 0.04)) return c;
    }
    let best = null, bestScore = Infinity;
    const cx = cam.W / 2;
    const target = geom.kind === 'area' ? project(cam, geom.centroid[0], geom.centroid[1]) : null;
    for (const s of geom.samples) {
      const p = project(cam, s[0], s[1]);
      if (!inFrame(cam, p, 0.03)) continue;
      const score = target
        ? Math.hypot(p.x - target.x, p.y - target.y)
        : Math.abs(p.x - cx) + Math.abs(p.y - cam.H * 0.55) * 0.3;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  // ---------- Hand-picked landmarks (data/dfw/landmarks.json) ----------
  let landmarksP = null;
  function loadLandmarks() {
    if (!landmarksP) landmarksP = loadManifest().then(m => fetch('data/dfw/landmarks.json?v=' + (m.version || '')))
      .then(r => { if (!r.ok) throw new Error('no landmarks'); return r.json(); }).then(d => d.landmarks || [])
      .catch(e => { landmarksP = null; console.warn('Landmarks unavailable:', e.message); return []; });
    return landmarksP;
  }
  async function landmarksNear(lat, lon) {
    return (await loadLandmarks()).map(l => {
      const mg = MERGED[l.cat];
      return {
        id: 'osm:landmark|' + l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        source: 'osm', cat: mg ? mg[0] : l.cat, name: l.name, lat: l.lat, lon: l.lon,
        ...(mg ? { kindIcon: mg[1] } : {}), ...(mg && mg[2] ? { farMi: mg[2] } : {}),
        distMi: P().distM(lat, lon, l.lat, l.lon) / MI, major: true, route: { lat: l.lat, lon: l.lon },
      };
    });
  }

  // ---------- Lot lines (county appraisal district maps) ----------
  // Asked in order; the first one that has a lot under the point wins. Only
  // the outline and acreage are requested, never owner details.
  // Lot lines come from appraisal district parcel maps. The statewide Texas
  // map (TxGIO StratMap, built from every county appraisal district) is
  // tried first; the county maps below are backups if it is down. Only the
  // outline is used; nothing else from these records is kept.
  const LOT_SOURCES = [
    { name: 'Texas statewide parcel map (county appraisal districts)', kind: 'identify',
      url: 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/identify',
      label: (a) => a.COUNTY ? `${titleCase(a.COUNTY)} County appraisal district` : null },
    { name: 'Denton County appraisal district', url: 'https://gis.dentoncounty.gov/arcgis/rest/services/CAD_GC/MapServer/0/query',
      fields: 'legal_acreage', acres: (a) => a.legal_acreage },
    { name: 'Collin County appraisal district', url: 'https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/FeatureServer/1/query',
      fields: 'OBJECTID' },
    { name: 'Tarrant County appraisal district', url: 'https://testmapit.fortworthtexas.gov/ags/rest/services/Basemaps/CAD_PARCELS_VIEW/MapServer/0/query',
      fields: 'LAND_ACRE', acres: (a) => a.LAND_ACRE },
    { name: 'City of Dallas tax parcels (Dallas County)', url: 'https://services2.arcgis.com/rwnOSbfKSwyTBcwN/ArcGIS/rest/services/DallasTaxParcels/FeatureServer/0/query',
      fields: 'AREA_FEET', acres: (a) => a.AREA_FEET ? a.AREA_FEET / 43560 : null },
  ];
  const LOT_COVERAGE = 'all of Texas, including every DFW county';
  const titleCase = (t) => String(t).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  // Drops corners that sit within tol meters of a straight line.
  function simplifyRing(ring, tol) {
    const lat0 = ring[0][0], lon0 = ring[0][1];
    const xy = ring.map(([la, lo]) => P().enu(lat0, lon0, la, lo));
    const keep = ring.map(() => false);
    const dp = (a, b) => {
      const [x1, y1] = xy[a], [x2, y2] = xy[b];
      const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((y2 - y1) * (xy[i][0] - x1) - (x2 - x1) * (xy[i][1] - y1)) / L;
        if (d > best) { best = d; bi = i; }
      }
      if (best > tol) { keep[bi] = true; dp(a, bi); dp(bi, b); }
    };
    // Split at the corner farthest from the first one, then simplify each half.
    let far = 0;
    xy.forEach((p, i) => { if (Math.hypot(p[0], p[1]) > Math.hypot(xy[far][0], xy[far][1])) far = i; });
    keep[0] = keep[far] = true;
    dp(0, far);
    xy.push(xy[0]); keep.push(true);
    dp(far, xy.length - 1);
    return ring.filter((_, i) => keep[i]);
  }

  // Is (x=lon, y=lat) inside the ring? And how far (meters) is it from the ring?
  function inRing(ring, lon, lat) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function ringDistM(ring, lon, lat) {
    const k = Math.cos(lat * Math.PI / 180);
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
      const ax = (x1 - lon) * k, ay = y1 - lat, bx = (x2 - lon) * k, by = y2 - lat;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-18;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy) * 111320);
    }
    return best;
  }
  // From several parcels, pick the one the point is in; otherwise the
  // nearest one within maxM meters (the address point often sits on the street).
  function pickParcel(features, lon, lat, maxM) {
    let best = null;
    for (const f of features) {
      const rings = f.geometry && f.geometry.rings;
      if (!rings || !rings.length) continue;
      const ring = rings.slice().sort((a, b) => b.length - a.length)[0];
      const d = inRing(ring, lon, lat) ? 0 : ringDistM(ring, lon, lat);
      if (d <= maxM && (!best || d < best.d)) best = { d, f, ring };
    }
    return best;
  }
  async function getJson(url, ms = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      return res.ok ? await res.json() : null;
    } finally { clearTimeout(timer); }
  }
  async function lookupParcel(src, lat, lon) {
    // Two tries: right at the point, then a wider search (~25 m) for the nearest lot.
    for (const [tolPx, maxM] of [[2, 3], [50, 25]]) {
      let feats;
      if (src.kind === 'identify') {
        const e = 0.001; // map window: about 200 m across, drawn at 400 px
        const p = new URLSearchParams({ geometry: JSON.stringify({ x: lon, y: lat }), geometryType: 'esriGeometryPoint', sr: '4326',
          layers: 'all:0', tolerance: String(tolPx), mapExtent: `${lon - e},${lat - e},${lon + e},${lat + e}`, imageDisplay: '400,400,96',
          returnGeometry: 'true', f: 'json' });
        const d = await getJson(src.url + '?' + p);
        if (!d || !d.results) throw new Error('no answer');
        feats = d.results.map(r => ({ geometry: r.geometry, attributes: r.attributes || {} }));
      } else {
        const r = maxM / 111320 * 1.2;
        const geom = tolPx <= 2 ? { geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint' }
          : { geometry: `${lon - r / Math.cos(lat * Math.PI / 180)},${lat - r},${lon + r / Math.cos(lat * Math.PI / 180)},${lat + r}`, geometryType: 'esriGeometryEnvelope' };
        const p = new URLSearchParams({ ...geom, inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: src.fields,
          returnGeometry: 'true', outSR: '4326', resultRecordCount: '50', f: 'json' });
        const d = await getJson(src.url + '?' + p);
        if (!d || d.error) throw new Error(d && d.error ? d.error.message : 'no answer');
        feats = d.features || [];
      }
      const hit = pickParcel(feats, lon, lat, maxM);
      if (hit) return hit;
    }
    return null;
  }

  // The house's real spot, from the appraisal district's address for each
  // lot. Street maps often put a house number on the wrong lot (in one test
  // "7" landed on #9, 110 m away), so the lot with that exact address is
  // looked for around the street map's guess. Only the address and outline
  // are read.
  const SUFFIX = /\b(CT|COURT|DR|DRIVE|LN|LANE|RD|ROAD|ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|CIR|CIRCLE|TRL|TRAIL|PKWY|PARKWAY|PL|PLACE|WAY|TER|TERRACE|LOOP|PATH|PT|POINT|COVE|CV|RUN|XING|CROSSING|HWY|N|S|E|W|NORTH|SOUTH|EAST|WEST)\b/g;
  const streetKey = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  function parseStreet(text) {
    const first = String(text || '').split(',')[0].trim();
    const m = first.match(/^(\d+[A-Z]?)\s+(.+)$/i);
    return m ? { num: m[1].toUpperCase(), key: streetKey(m[2]) } : null;
  }
  // A spot inside the lot: its middle, or the middle of a line across it
  // for odd shapes.
  function pointInside(ring) {
    let A = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j], [x1, y1] = ring[i], c = x0 * y1 - x1 * y0;
      A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    if (Math.abs(A) > 1e-14) { cx /= 3 * A; cy /= 3 * A; if (inRing(ring, cx, cy)) return [cx, cy]; }
    const ys = ring.map(p => p[1]), y = (Math.min(...ys) + Math.max(...ys)) / 2, xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    return xs.length >= 2 ? [(xs[0] + xs[1]) / 2, y] : ring[0];
  }
  async function biggestBuilding(ring) {
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const q = `[out:json][timeout:15];way["building"](${Math.min(...ys)},${Math.min(...xs)},${Math.max(...ys)},${Math.max(...xs)});out geom;`;
    // A small question, so ask every map server at once and use the first answer.
    let data = await cacheGet(q);
    if (!data) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        data = await Promise.any(OVERPASS.map(async (url) => {
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(q), signal: ctrl.signal });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        }));
        cachePut(q, data);
      } finally { clearTimeout(timer); ctrl.abort(); }
    }
    let best = null;
    for (const w of (data && data.elements) || []) {
      const g = (w.geometry || []).map(n => [n.lon, n.lat]);
      if (g.length < 3) continue;
      const [cx, cy] = pointInside(g);
      if (!inRing(ring, cx, cy)) continue;
      const lat0 = g[0][1], lon0 = g[0][0];
      const area = Math.abs(ringArea(g.map(([x, y]) => [y, x]), lat0, lon0));
      if (!best || area > best.area) best = { lat: cy, lon: cx, area };
    }
    return best && best.area > 40 ? best : null; // skip sheds
  }
  async function findAddressLot(text, lat, lon) {
    const want = parseStreet(text);
    if (!want || !want.key) return null;
    const src = LOT_SOURCES[0];
    for (const e of [0.003, 0.009]) { // about 300 m, then 1 km around the guess
      const p = new URLSearchParams({ geometry: JSON.stringify({ xmin: lon - e, ymin: lat - e, xmax: lon + e, ymax: lat + e }),
        geometryType: 'esriGeometryEnvelope', sr: '4326', layers: 'all:0', tolerance: '0',
        mapExtent: `${lon - e},${lat - e},${lon + e},${lat + e}`, imageDisplay: '400,400,96', returnGeometry: 'true', f: 'json' });
      const d = await getJson(src.url + '?' + p, 20000);
      if (!d || !d.results) return null;
      let best = null;
      for (const r of d.results) {
        const a = r.attributes || {}, addr = String(a.SITUS_ADDR || '').toUpperCase();
        const num = String(a.SITUS_NUM && a.SITUS_NUM !== 'Null' ? a.SITUS_NUM : addr.split(' ')[0]).toUpperCase();
        if (num !== want.num) continue;
        const k = streetKey([a.SITUS_STRE, a.SITUS_ST_1, a.SITUS_ST_2].filter(v => v && v !== 'Null').join(' ') || addr.split(',')[0].replace(/^\S+\s+/, ''));
        if (!k || !(k === want.key || k.includes(want.key) || want.key.includes(k))) continue;
        const rings = r.geometry && r.geometry.rings;
        if (!rings || !rings.length) continue;
        const ring = rings.slice().sort((x, y) => y.length - x.length)[0];
        const [x, y] = pointInside(ring);
        const dm = P().distM(lat, lon, y, x);
        if (!best || dm < best.d) best = { lat: y, lon: x, d: dm, ring };
      }
      if (best) {
        // On a big or long lot the middle can be far from the house, so use
        // the biggest building on the lot when the map has one.
        const h = await biggestBuilding(best.ring).catch(() => null);
        if (h) { best.lat = h.lat; best.lon = h.lon; best.onBuilding = true; }
        delete best.ring;
        return best;
      }
    }
    return null;
  }

  async function findLot(lat, lon) {
    for (const src of LOT_SOURCES) {
      try {
        const hit = await lookupParcel(src, lat, lon);
        if (!hit) continue;
        const ring = hit.ring.map(([x, y]) => [y, x]);
        if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
        if (ring.length < 3) continue;
        const simple = simplifyRing(ring, 0.6); // fewer corner handles on curved edges
        const a = hit.f.attributes || {};
        const acres = src.acres ? Number(src.acres(a)) : null;
        return { ring: simple.length >= 3 ? simple : ring, source: (src.label && src.label(a)) || src.name,
          acres: acres > 0 ? Math.round(acres * 100) / 100 : null, nearby: hit.d > 0 };
      } catch (e) { console.warn('Lot lookup failed:', src.name, e.message); }
    }
    return null;
  }

  const providers = {
    osm: { id: 'osm', name: 'OpenStreetMap (free)', attribution: '© OpenStreetMap contributors', search: searchOsm },
    // google: added in a later stage (mainly for retail), with a spending cap.
  };

  DT.places = { MERGED, DEFAULT_CATEGORIES, ROAD_TYPES, providers, anchorFor, MI, loadManifest, landmarksNear, findLot, findAddressLot, LOT_SOURCES, LOT_COVERAGE };
})(window.DT = window.DT || {});
