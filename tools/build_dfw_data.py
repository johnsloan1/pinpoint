#!/usr/bin/env python3
"""Builds the ready-made DFW place data that Pinpoint loads instead of
asking the busy free map servers on every job.

Run it from the drone-tag folder:   python3 tools/build_dfw_data.py
It takes 10-40 minutes (the free servers are slow) and writes data/dfw/.
Re-running resumes: finished downloads are kept in tools/.cache/ for 20 days.
A monthly GitHub Action can run it automatically once the app is hosted.
"""
import json, math, os, subprocess, sys, time, concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'dfw')
CACHE = os.path.join(ROOT, 'tools', '.cache')

# Area covered: Denton/McKinney in the north to Waxahachie/Cleburne in the
# south, Weatherford in the west to Forney/Rockwall in the east.
S, N, W, E = 32.0, 34.0, -98.5, -96.0  # Hillsboro–Red River, Stephenville/Granbury–Greenville
TILE = 0.25    # tile size in degrees; the app loads only the tiles it needs
BLOCK = 0.5    # download size in degrees

SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
]

# Same searches the app runs live (see js/places.js), over the whole area.
GROUPS = {
    'school': 'nwr{b}[amenity~"^(school|kindergarten|childcare)$"][name];',
    'park': 'nwr{b}[leisure=park][name];',
    'highway': 'way{b}[highway~"^(motorway|trunk)$"];way{b}[highway=primary][ref];',
    'water': 'nwr{b}[natural=water][name];way{b}[waterway=river][name~"River"];rel{b}[waterway=river][name~"River"];',
    'amenity': 'way{b}[leisure=swimming_pool];nwr{b}[leisure=water_park];nwr{b}[amenity~"^(community_centre|clubhouse)$"];nwr{b}[building=clubhouse];nwr{b}[leisure=sports_centre][name];',
    'attraction': ('nwr{b}[tourism~"^(museum|zoo|aquarium|theme_park|attraction)$"][name];nwr{b}[leisure~"^(stadium|water_park|golf_course|sports_centre)$"][name];nwr{b}[amenity=events_venue][name];'
                   'nwr{b}[leisure=garden]["garden:type"=botanical][name];nwr{b}[amenity~"^(theatre|arts_centre|university|college|hospital)$"][name];wr{b}[landuse=retail][name];'),
    'extra': ('way{b}[highway~"^(path|cycleway|footway|bridleway)$"][name~"trail|greenbelt|greenway",i];nwr{b}[leisure=marina];nwr{b}[leisure=slipway];'
              'nwr{b}[amenity~"^(place_of_worship|library|townhall)$"][name];'),
    'shop': 'nwr{b}[shop~"^(supermarket|department_store|wholesale|mall|doityourself|hardware|electronics|furniture|sports)$"][name];',
}
KEEP = {'name', 'ref', 'amenity', 'operator', 'operator:type', 'school:type', 'religion', 'highway',
        'natural', 'water', 'waterway', 'leisure', 'shop', 'brand', 'brand:wikidata', 'type', 'access', 'building',
        'tourism', 'wikidata', 'garden:type', 'landuse'}
TOL = {'school': 6, 'park': 10, 'highway': 8, 'water': 15, 'shop': 6, 'amenity': 3, 'attraction': 8, 'extra': 6}  # meters


def fetch(query, key, server_i):
    path = os.path.join(CACHE, key + '.json')
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 20 * 86400:
        with open(path) as f:
            return json.load(f)
    last = None
    for attempt in range(8):
        url = SERVERS[(server_i + attempt) % len(SERVERS)]
        try:
            r = subprocess.run(['curl', '-sS', '-m', '400', '-A', 'Pinpoint-data-builder/1.0',
                                '--data-urlencode', 'data=' + query, '-w', '\n%{http_code}', url],
                               capture_output=True, text=True, timeout=420)
            body, _, code = r.stdout.rpartition('\n')
            if code != '200':
                raise RuntimeError(f'HTTP {code} {r.stderr.strip()[:80]}')
            data = json.loads(body)
            if data.get('remark') and 'error' in data['remark'].lower():
                raise RuntimeError(data['remark'][:120])
            os.makedirs(CACHE, exist_ok=True)
            with open(path, 'w') as f:
                json.dump(data, f)
            return data
        except Exception as e:
            last = e
            print(f'  {key}: {url.split("/")[2]} failed ({e}); retrying', flush=True)
            time.sleep(10 + 10 * attempt)
    raise RuntimeError(f'{key}: gave up ({last})')


def simplify(pts, tol):
    """Douglas-Peucker in local meters. Closed loops (first point == last)
    are split at their farthest point first, or they'd collapse to a line."""
    if len(pts) < 3:
        return pts
    if pts[0] == pts[-1] and len(pts) > 3:
        x0, y0 = pts[0]
        k = max(range(len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
        return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)
    lat0 = math.radians(pts[0][0])
    kx, ky = 111320 * math.cos(lat0), 110540
    xy = [(p[1] * kx, p[0] * ky) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = xy[a], xy[b]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            d = abs(dy * (xy[i][0] - x1) - dx * (xy[i][1] - y1)) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def pts_of(g, tol):
    return [[round(p[0], 5), round(p[1], 5)] for p in simplify([[q['lat'], q['lon']] for q in g], tol)]


def area_m2(g):
    kx = 111320 * math.cos(math.radians(g[0]['lat']))
    a = sum(g[i]['lon'] * kx * g[i + 1]['lat'] * 110540 - g[i + 1]['lon'] * kx * g[i]['lat'] * 110540 for i in range(len(g) - 1))
    return abs(a) / 2


def tiles_for(points):
    la = [p[0] for p in points]; lo = [p[1] for p in points]
    r0, r1 = int((min(la) - S) // TILE), int((max(la) - S) // TILE)
    c0, c1 = int((min(lo) - W) // TILE), int((max(lo) - W) // TILE)
    rows, cols = int(round((N - S) / TILE)), int(round((E - W) / TILE))
    for r in range(max(0, r0), min(rows - 1, r1) + 1):
        for c in range(max(0, c0), min(cols - 1, c1) + 1):
            yield f'{r}_{c}'


def compact(el, group):
    """Smaller version of an OpenStreetMap element: only the tags we use and
    simplified outlines. Returns a list (long rivers are split by segment)."""
    tags = {k: v for k, v in (el.get('tags') or {}).items() if k in KEEP}
    tol = TOL[group]
    t = el['type']
    if t == 'node':
        return [{'t': 'n', 'i': el['id'], 'k': tags, 'g': [[round(el['lat'], 5), round(el['lon'], 5)]]}]
    if t == 'way':
        g = el.get('geometry')
        if not g:
            return []
        if tags.get('leisure') == 'swimming_pool' and area_m2(g) < 140:
            return []  # backyard pool
        if tags.get('landuse') == 'retail' and area_m2(g) < 48000:
            return []  # strip center, not a landmark district
        closed = len(g) > 3 and g[0] == g[-1]
        pts = pts_of(g, tol)
        if closed and pts[0] != pts[-1]:
            pts.append(pts[0])
        return [{'t': 'w', 'i': el['id'], 'k': tags, 'g': pts}]
    if t == 'relation':
        members = [m for m in el.get('members', []) if m.get('geometry') and m.get('role') in ('outer', '', 'main_stream')]
        if tags.get('type') == 'waterway' or tags.get('waterway'):
            # Rivers: each segment on its own, so a tile only holds nearby parts.
            return [{'t': 'w', 'i': f'{el["id"]}r{j}', 'k': tags, 'g': pts_of(m['geometry'], tol)}
                    for j, m in enumerate(members)]
        return [{'t': 'r', 'i': el['id'], 'k': tags, 'm': [pts_of(m['geometry'], tol) for m in members]}]
    return []


def main():
    blocks = []
    lat = S
    while lat < N - 1e-9:
        lon = W
        while lon < E - 1e-9:
            blocks.append((lat, lon))
            lon += BLOCK
        lat += BLOCK
    jobs = [(g, b) for g in GROUPS for b in blocks]
    print(f'Downloading {len(jobs)} pieces from OpenStreetMap…', flush=True)
    results = {g: {} for g in GROUPS}

    def run(i, job):
        g, (la, lo) = job
        b = f'({la},{lo},{la + BLOCK},{lo + BLOCK})'
        q = f'[out:json][timeout:300];({GROUPS[g].format(b=b)});out geom;'
        return g, fetch(q, f'{g}_{la}_{lo}', i)

    done = 0
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(run, i, j) for i, j in enumerate(jobs)]
        for f in cf.as_completed(futs):
            g, data = f.result()
            for el in data.get('elements', []):
                for c in compact(el, g):
                    results[g][f'{c["t"]}{c["i"]}'] = c
            done += 1
            print(f'  {done}/{len(jobs)} done', flush=True)

    os.makedirs(OUT, exist_ok=True)
    manifest = {'built': time.strftime('%Y-%m-%d'), 'version': int(time.time()), 'bbox': [S, W, N, E], 'tile': TILE, 'groups': {}}
    total = 0
    for g, els in results.items():
        tiles = {}
        for c in els.values():
            pts = c.get('g') or [p for m in c.get('m', []) for p in m]
            if not pts:
                continue
            for key in tiles_for(pts):
                tiles.setdefault(key, []).append(c)
        gdir = os.path.join(OUT, g)
        os.makedirs(gdir, exist_ok=True)
        for old in os.listdir(gdir):
            os.remove(os.path.join(gdir, old))
        for key, items in tiles.items():
            with open(os.path.join(gdir, key + '.json'), 'w') as f:
                json.dump({'e': items}, f, separators=(',', ':'))
        manifest['groups'][g] = sorted(tiles)
        size = sum(os.path.getsize(os.path.join(gdir, x)) for x in os.listdir(gdir))
        total += size
        print(f'{g}: {len(els)} places/pieces in {len(tiles)} tiles, {size / 1e6:.1f} MB', flush=True)
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f)
    print(f'Done. {total / 1e6:.1f} MB written to data/dfw/', flush=True)


if __name__ == '__main__':
    sys.exit(main())
