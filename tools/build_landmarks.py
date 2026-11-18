#!/usr/bin/env python3
"""Builds data/dfw/landmarks.json: a hand-picked list of skylines, airports,
business hubs and a few big venues, with positions looked up on OpenStreetMap's free address
search (Nominatim, max 1 request per second).

Run from the drone-tag folder:   python3 tools/build_landmarks.py
Edit the LIST below to add or rename landmarks. A fixed "at" position skips
the lookup (use it when the search finds the wrong spot).
"""
import json, os, subprocess, time, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'dfw', 'landmarks.json')

# (category, label shown on the callout, search text or None, fixed (lat, lon) or None)
LIST = [
    ('skyline', 'Downtown Dallas', 'Bank of America Plaza, Dallas, Texas', None),
    ('skyline', 'Downtown Fort Worth', 'Burnett Plaza, Fort Worth, Texas', None),
    ('skyline', 'Reunion Tower', 'Reunion Tower, Dallas, Texas', None),
    ('airport', 'DFW Airport', 'Dallas Fort Worth International Airport', None),
    ('airport', 'Dallas Love Field', 'Dallas Love Field Airport', None),
    ('airport', 'Alliance Airport', 'Fort Worth Alliance Airport', None),
    ('airport', 'Addison Airport', 'Addison Airport, Addison, Texas', None),
    ('airport', 'Meacham Airport', 'Fort Worth Meacham International Airport', None),
    ('airport', 'McKinney National Airport', 'McKinney National Airport', None),
    ('airport', 'Denton Enterprise Airport', 'Denton Enterprise Airport', None),
    ('airport', 'Dallas Executive Airport', 'Dallas Executive Airport', None),
    ('airport', 'Arlington Municipal Airport', 'Arlington Municipal Airport, Texas', None),
    ('business', 'Legacy West', 'Legacy West, Plano, Texas', None),
    ('business', 'Granite Park', 'Granite Park, Plano, Texas', None),
    ('business', 'The Star in Frisco', 'Dallas Cowboys World Headquarters, Frisco, Texas', (33.1097, -96.8287)),
    ('business', 'Las Colinas', 'Las Colinas Urban Center, Irving, Texas', None),
    ('business', 'CityLine', 'CityLine, Richardson, Texas', None),
    ('business', 'AllianceTexas', 'Alliance Town Center, Fort Worth, Texas', None),
    ('business', 'Uptown Dallas', 'Uptown, Dallas, Texas', None),
    ('business', 'Dallas Galleria', 'Galleria Dallas, Texas', None),
    # Big venues missing from OpenStreetMap's stadium/arena tags.
    ('attraction', 'Dickies Arena', '1911 Montgomery Street, Fort Worth, Texas', None),
]


def search(q):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': q, 'format': 'json', 'limit': 1, 'countrycodes': 'us', 'viewbox': '-98,34,-96,32', 'bounded': 1})
    r = subprocess.run(['curl', '-sS', '-m', '30', '-A', 'Pinpoint-data-builder/1.0', url], capture_output=True, text=True)
    try:
        hit = json.loads(r.stdout)
    except ValueError:
        return None
    return (round(float(hit[0]['lat']), 5), round(float(hit[0]['lon']), 5), hit[0].get('display_name', '')) if hit else None


def main():
    out = []
    for cat, label, q, at in LIST:
        if at:
            lat, lon, found = at[0], at[1], 'fixed position'
        else:
            res = search(q)
            time.sleep(1.2)
            if not res:
                print(f'  NOT FOUND: {label} ({q})')
                continue
            lat, lon, found = res
        print(f'  {cat:8} {label:28} {lat:.5f},{lon:.5f}  <- {found[:70]}')
        out.append({'cat': cat, 'name': label, 'lat': lat, 'lon': lon})
    with open(OUT, 'w') as f:
        json.dump({'built': time.strftime('%Y-%m-%d'), 'landmarks': out}, f, indent=1)
    print(f'Wrote {len(out)} landmarks to data/dfw/landmarks.json')


if __name__ == '__main__':
    main()
