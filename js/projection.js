// Camera math: turns a real-world latitude/longitude into a pixel position
// in the photo, using where the drone was, how high it was, and which way
// the camera pointed.
(function (DT) {
  const R = 6371008.8;           // Earth radius in meters
  const D2R = Math.PI / 180;
  const REFRACTION = 0.13;       // light bends slightly over long distances
  const FULL_FRAME_DIAG = 43.2666; // mm, used with "35mm equivalent" focal length

  function enu(lat0, lon0, lat, lon) {
    return [
      (lon - lon0) * D2R * R * Math.cos(lat0 * D2R),
      (lat - lat0) * D2R * R,
    ];
  }
  function fromEnu(lat0, lon0, e, n) {
    return [lat0 + n / (R * D2R), lon0 + e / (R * D2R * Math.cos(lat0 * D2R))];
  }
  function distM(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function offset(lat, lon, distance, bearingDeg) {
    const b = bearingDeg * D2R;
    return fromEnu(lat, lon, distance * Math.sin(b), distance * Math.cos(b));
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // DJI photos record two compass headings: the camera gimbal's and the
  // drone body's. Usually they agree; on some cameras one is off, so the
  // photo can say which one to trust (adj.heading = 'gimbal' | 'body').
  function baseYaw(photo) {
    const m = photo.meta;
    return photo.adj.heading === 'body' && m.flightYaw != null ? m.flightYaw : m.yaw;
  }
  function headingGap(meta) {
    if (meta.yaw == null || meta.flightYaw == null) return 0;
    return Math.abs(((meta.flightYaw - meta.yaw + 540) % 360) - 180);
  }

  function isManual(photo) {
    return !!(photo.adj.manual || !photo.meta.hasDirection);
  }

  // Build the camera for one photo. Returns null if we don't have enough
  // information yet (e.g. no direction data and no house location).
  function buildCamera(photo, house) {
    const m = photo.meta, a = photo.adj;
    let lat, lon, h, yaw, pitch, roll;
    if (!isManual(photo)) {
      if (!m.hasGps) return null;
      lat = m.lat; lon = m.lon;
      h = a.height ?? m.relAlt ?? 60;
      yaw = baseYaw(photo) + a.dYaw; pitch = m.pitch + a.dPitch; roll = (m.roll || 0) + a.dRoll;
    } else {
      if (m.hasGps) { lat = m.lat; lon = m.lon; }
      else if (house) { [lat, lon] = offset(house.lat, house.lon, a.mDist, a.mBearing); }
      else return null;
      h = a.mHeight; yaw = a.mYaw; pitch = a.mPitch; roll = a.dRoll;
    }

    // Lens: work out the focal length in pixels. If Lightroom cropped the
    // photo, the crop tells us how big the original frame was.
    const W = photo.W, H = photo.H;
    const c = m.crop || { l: 0, t: 0, r: 1, b: 1 };
    const Wf = W / (c.r - c.l), Hf = H / (c.b - c.t);
    const f35 = m.f35 || 24;
    const fpx = f35 * Math.hypot(Wf, Hf) / FULL_FRAME_DIAG * (a.zoom || 1);
    const cx = (0.5 - c.l) * Wf, cy = (0.5 - c.t) * Hf;

    const y = yaw * D2R, p = pitch * D2R, r = roll * D2R;
    const fwd = [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), Math.sin(p)];
    const r0 = [Math.cos(y), -Math.sin(y), 0];
    const u0 = cross(r0, fwd);
    const cr = Math.cos(r), sr = Math.sin(r);
    const right = [0, 1, 2].map(i => r0[i] * cr - u0[i] * sr);
    const up = [0, 1, 2].map(i => u0[i] * cr + r0[i] * sr);
    return { lat, lon, h, yaw, pitch, roll, fpx, cx, cy, W, H, fwd, right, up };
  }

  // Real-world point -> pixel. Returns null if the point is behind the camera.
  function project(cam, lat, lon, elev = 0) {
    const [e, n] = enu(cam.lat, cam.lon, lat, lon);
    const u = elev - cam.h - (e * e + n * n) * (1 - REFRACTION) / (2 * R);
    const v = [e, n, u];
    const z = v[0] * cam.fwd[0] + v[1] * cam.fwd[1] + v[2] * cam.fwd[2];
    if (z <= 1) return null;
    const x = v[0] * cam.right[0] + v[1] * cam.right[1] + v[2] * cam.right[2];
    const y = v[0] * cam.up[0] + v[1] * cam.up[1] + v[2] * cam.up[2];
    return { x: cam.cx + cam.fpx * x / z, y: cam.cy - cam.fpx * y / z, z };
  }

  function inFrame(cam, p, margin = 0.01) {
    if (!p) return false;
    const mx = cam.W * margin, my = cam.H * margin;
    return p.x >= mx && p.x <= cam.W - mx && p.y >= my && p.y <= cam.H - my;
  }

  // Pixel -> real-world point on the ground. Returns null for sky pixels.
  function unproject(cam, px, py) {
    const xn = (px - cam.cx) / cam.fpx, yn = -(py - cam.cy) / cam.fpx;
    const d = [0, 1, 2].map(i => cam.fwd[i] + cam.right[i] * xn + cam.up[i] * yn);
    if (d[2] >= -1e-4) return null;
    const t = -cam.h / d[2];
    if (t > 40000) return null;
    const [lat, lon] = fromEnu(cam.lat, cam.lon, d[0] * t, d[1] * t);
    return { lat, lon };
  }

  // Where the horizon crosses the photo's left and right edges (pixels), or
  // null when the camera points too far down to see it. Everything above
  // this line is sky.
  function horizon(cam) {
    if (!(cam.up[2] > 1e-3)) return null;
    const dip = Math.sqrt(2 * Math.max(cam.h, 1) * (1 - REFRACTION) / R); // the horizon sits a hair below level
    const at = (px) => {
      const xn = (px - cam.cx) / cam.fpx;
      let yn = 0;
      for (let k = 0; k < 3; k++) yn = (-Math.sin(dip) * Math.hypot(1, xn, yn) - cam.fwd[2] - cam.right[2] * xn) / cam.up[2];
      return cam.cy - cam.fpx * yn;
    };
    const y0 = at(0), y1 = at(cam.W);
    if (y0 < 0 && y1 < 0) return null; // above the top of the photo
    return [{ x: 0, y: y0 }, { x: cam.W, y: y1 }];
  }

  // Nudge two camera settings so a known real-world point lands on a
  // target pixel (used for "line everything up with the house pin").
  function solveAlign(photo, house, target, keys) {
    const adj = photo.adj;
    const err = () => {
      const cam = buildCamera(photo, house);
      const p = cam && project(cam, house.lat, house.lon);
      return p ? [target.x - p.x, target.y - p.y] : null;
    };
    for (let iter = 0; iter < 25; iter++) {
      const e0 = err();
      if (!e0) return false;
      if (Math.hypot(e0[0], e0[1]) < 0.3) return true;
      const J = [];
      for (const k of keys) {
        const step = 0.01;
        adj[k] += step;
        const e1 = err();
        adj[k] -= step;
        if (!e1) return false;
        J.push([(e0[0] - e1[0]) / step, (e0[1] - e1[1]) / step]);
      }
      // Solve the 2x2 system J * delta = e0
      const [a, c] = J[0], [b, d] = J[1];
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-9) return false;
      const d0 = (d * e0[0] - b * e0[1]) / det;
      const d1 = (-c * e0[0] + a * e0[1]) / det;
      adj[keys[0]] += Math.max(-10, Math.min(10, d0));
      adj[keys[1]] += Math.max(-10, Math.min(10, d1));
    }
    return true;
  }

  // Fit the camera to several known points at once (house pin plus any
  // callout dots you dragged onto the right spot). More points let it
  // correct more: 1 point = turn + tilt, 2 = also level, 3+ = also lens zoom.
  function solveFit(photo, house, targets, keys) {
    const adj = photo.adj;
    const STEP = { zoom: 0.0005 };
    const resid = () => {
      const cam = buildCamera(photo, house);
      if (!cam) return null;
      const r = [];
      for (const t of targets) {
        const p = project(cam, t.lat, t.lon);
        if (!p) return null;
        r.push(t.x - p.x, t.y - p.y);
      }
      return r;
    };
    const norm = (r) => Math.sqrt(r.reduce((s, v) => s + v * v, 0) / (r.length / 2));
    let r0 = resid();
    if (!r0) return null;
    let lambda = 1e-3;
    for (let iter = 0; iter < 60; iter++) {
      const J = keys.map(k => {
        const h = STEP[k] || 0.01;
        adj[k] += h; const r1 = resid(); adj[k] -= h;
        return r1 ? r0.map((v, i) => (v - r1[i]) / h) : null;
      });
      if (J.some(c => !c)) return null;
      const n = keys.length;
      const A = keys.map((_, i) => keys.map((_, j) => J[i].reduce((s, v, q) => s + v * J[j][q], 0)));
      const g = keys.map((_, i) => J[i].reduce((s, v, q) => s + v * r0[q], 0));
      for (let i = 0; i < n; i++) A[i][i] *= 1 + lambda;
      const d = solveLinear(A, g);
      if (!d) return null;
      const old = keys.map(k => adj[k]);
      keys.forEach((k, i) => {
        const lim = k === 'zoom' ? 0.05 : 10;
        adj[k] += Math.max(-lim, Math.min(lim, d[i]));
        if (k === 'zoom') adj[k] = Math.max(0.6, Math.min(1.6, adj[k]));
      });
      const r1 = resid();
      if (r1 && norm(r1) < norm(r0)) {
        const gain = norm(r0) - norm(r1);
        r0 = r1; lambda = Math.max(1e-6, lambda / 3);
        if (gain < 0.01) break;
      } else {
        keys.forEach((k, i) => { adj[k] = old[i]; });
        lambda *= 10;
        if (lambda > 1e6) break;
      }
    }
    return norm(r0);
  }
  function solveLinear(A, b) {
    const n = b.length, M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  DT.projection = { horizon, buildCamera, baseYaw, headingGap, solveFit, project, unproject, inFrame, distM, offset, enu, fromEnu, solveAlign, isManual };
})(window.DT = window.DT || {});
