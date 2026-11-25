// Outside services (address lookup, driving routes) and saved settings.
(function (DT) {
  // ---- Address lookup (OpenStreetMap Nominatim, free) ----
  async function geocode(address) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=' + encodeURIComponent(address);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Address lookup failed (HTTP ' + res.status + ')');
    const rows = await res.json();
    if (!rows.length) return null;
    return { lat: parseFloat(rows[0].lat), lon: parseFloat(rows[0].lon), label: rows[0].display_name };
  }

  // Nominatim allows about one request per second; space them out.
  let lastNom = 0;
  async function nominatim(path, params) {
    const wait = lastNom + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastNom = Date.now();
    const url = 'https://nominatim.openstreetmap.org/' + path + '?' + new URLSearchParams({ format: 'jsonv2', addressdetails: '1', ...params });
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Address lookup failed (HTTP ' + res.status + ')');
    return res.json();
  }
  const STATES = { Texas: 'TX', Oklahoma: 'OK', Louisiana: 'LA', Arkansas: 'AR', 'New Mexico': 'NM' };
  function placeOf(a) { return a.city || a.town || a.village || a.hamlet || a.suburb || a.county || ''; }
  function formatAddress(a, street) {
    const st = street || [a.house_number, a.road].filter(Boolean).join(' ');
    const state = STATES[a.state] || a.state || '';
    return [st, placeOf(a), [state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
  const dist = (a, b) => {
    const k = Math.cos(a.lat * Math.PI / 180);
    return Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * k);
  };
  // Address from a spot on the map (e.g. where the drone camera was aimed).
  async function reverseGeocode(lat, lon) {
    const r = await nominatim('reverse', { lat, lon, zoom: '18' });
    if (!r || r.error || !r.address) return null;
    return { address: formatAddress(r.address), label: r.display_name, exact: !!r.address.house_number, a: r.address };
  }
  // Street address (usually just “123 Main St”, no city) near a known
  // spot (the photos' GPS). Picks the match closest to that spot.
  async function geocodeNear(street, near) {
    const num = (street.match(/^\d+/) || [''])[0];
    const pick = (rows, maxM) => {
      let best = null;
      for (const r of rows || []) {
        const p = { lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
        const d = near ? dist(p, near) : 0;
        if (d > maxM) continue;
        const exact = !!(r.address && r.address.house_number && r.address.house_number.split(/[;,]/).includes(num));
        const score = d - (exact ? 5000 : 0);
        if (!best || score < best.score) best = { ...p, score, exact, r };
      }
      return best;
    };
    let hit = null;
    if (near) {
      const vb = `${near.lon - 0.07},${near.lat + 0.06},${near.lon + 0.07},${near.lat - 0.06}`;
      hit = pick(await nominatim('search', { q: street, countrycodes: 'us', limit: '10', viewbox: vb, bounded: '1' }), 6000);
      if (!hit || !hit.exact) {
        // Add the city from the GPS spot and try again.
        const here = await reverseGeocode(near.lat, near.lon).catch(() => null);
        const city = here && placeOf(here.a);
        if (city) {
          const h2 = pick(await nominatim('search', { q: `${street}, ${city}, ${here.a.state || 'Texas'}`, countrycodes: 'us', limit: '10' }), 10000);
          if (h2 && (!hit || (h2.exact && !hit.exact))) hit = h2;
        }
      }
    } else {
      hit = pick(await nominatim('search', { q: street + ', Texas', countrycodes: 'us', limit: '5', viewbox: '-98.2,34.2,-95.8,31.8', bounded: '1' }), Infinity);
    }
    if (!hit) return null;
    const a = hit.r.address || {};
    const nice = street === street.toLowerCase() || street === street.toUpperCase() ? street.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : street;
    return { lat: hit.lat, lon: hit.lon, exact: hit.exact, label: hit.r.display_name, address: formatAddress(a, nice) };
  }

  // Places by name near the property (for "Find a place"), closest first.
  async function searchPlaces(q, near) {
    const out = [], seen = new Set();
    const add = (rows) => {
      for (const r of rows || []) {
        const name = r.name || (r.display_name || '').split(',')[0];
        const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
        const k = name.toLowerCase() + Math.round(lat * 500) + Math.round(lon * 500);
        if (!name || seen.has(k)) continue;
        seen.add(k);
        const a = r.address || {};
        out.push({ name, lat, lon, kind: (r.type || '').replace(/_/g, ' '), where: placeOf(a), label: r.display_name, d: near ? dist({ lat, lon }, near) : 0 });
      }
    };
    if (near) {
      const vb = `${near.lon - 0.3},${near.lat + 0.25},${near.lon + 0.3},${near.lat - 0.25}`;
      add(await nominatim('search', { q, countrycodes: 'us', limit: '10', viewbox: vb, bounded: '1' }));
    }
    if (out.length < 3) add(await nominatim('search', { q: q + ', Texas', countrycodes: 'us', limit: '8', viewbox: '-98.6,34.2,-95.8,31.8', bounded: '1' }));
    return out.sort((a, b) => a.d - b.d).slice(0, 8);
  }

  // ---- Driving distance/time ----
  // Starts with the free public OSRM server. A Google Routes provider can be
  // added here later with the same function shape.
  const routing = {
    osrm: {
      name: 'OSRM (free)',
      async table(origin, dests) {
        const out = {};
        for (let i = 0; i < dests.length; i += 80) {
          const batch = dests.slice(i, i + 80);
          const coords = [origin, ...batch].map(p => p.lon.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
          const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Routing failed (HTTP ' + res.status + ')');
          const data = await res.json();
          if (data.code !== 'Ok') throw new Error('Routing failed: ' + data.code);
          batch.forEach((d, k) => {
            const sec = data.durations[0][k + 1], m = data.distances[0][k + 1];
            if (sec != null && m != null) out[d.id] = { min: sec / 60, mi: m / 1609.344 };
          });
        }
        return out;
      },
    },
  };

  // ---- Saved settings (presets, logo library) ----
  // Stage 1: saved in this browser. A Google Drive backend with the same
  // load/save functions will replace this so the whole team shares them.
  const store = {
    backend: 'This browser only',
    async load(key, fallback) {
      try { const v = localStorage.getItem('dronetag:' + key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    async save(key, value) {
      try { localStorage.setItem('dronetag:' + key, JSON.stringify(value)); return true; }
      catch (e) { console.warn('Could not save', key, e); return false; }
    },
  };

  // ---- Ground height above sea level (USGS, free, US only) ----
  // Returns meters, or null if unknown. Remembered per spot.
  const elevCache = new Map();
  function groundElevation(lat, lon) {
    const key = lat.toFixed(5) + ',' + lon.toFixed(5);
    if (!elevCache.has(key)) {
      const url = 'https://epqs.nationalmap.gov/v1/json?' + new URLSearchParams({ x: lon, y: lat, units: 'Meters', wkid: 4326 });
      elevCache.set(key, fetch(url).then(r => r.ok ? r.json() : null).then(j => {
        const v = j && parseFloat(j.value);
        return isFinite(v) && v > -500 ? v : null;
      }).catch(() => { elevCache.delete(key); return null; }));
    }
    return elevCache.get(key);
  }

  DT.services = {geocode, groundElevation, geocodeNear, reverseGeocode, searchPlaces, routing, store };
})(window.DT = window.DT || {});
