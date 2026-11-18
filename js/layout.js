// Automatic placement: puts each callout box above its dot and slides it
// up or sideways until it no longer overlaps other boxes, dots or the pin.
(function (DT) {
  function overlaps(a, b, pad) {
    return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  }

  // items: [{ id, ax, ay, w, h, fixed: {x,y}|null }]
  // Returns a map id -> {x, y, w, h}
  function autoLayout(items, opts) {
    const { W, H, leader, pad, dotR, obstacles = [] } = opts;
    const margin = W * 0.012;
    const placed = [...obstacles];
    const out = {};
    for (const it of items) {
      if (it.fixed) {
        const r = { x: it.fixed.x, y: it.fixed.y, w: it.w, h: it.h };
        out[it.id] = r;
        placed.push(r);
      }
    }
    const dots = items.map(it => ({ id: it.id, x: it.ax - dotR, y: it.ay - dotR, w: dotR * 2, h: dotR * 2 }));
    const auto = items.filter(it => !it.fixed).sort((a, b) => a.ay - b.ay || a.ax - b.ax);

    const clampX = (x, w) => Math.max(margin, Math.min(W - w - margin, x));
    const clampY = (y, h) => Math.max(margin, Math.min(H - h - margin, y));

    for (const it of auto) {
      let best = null, bestScore = Infinity;
      const stepsY = [0, 0.6, 1.2, 1.8, 2.4, 3.2, 4, 5, 6.5, 8];
      const stepsX = [0, -0.35, 0.35, -0.7, 0.7, -1.05, 1.05, -1.4, 1.4];
      for (const below of [false, true]) {
        for (const sy of stepsY) {
          for (const sx of stepsX) {
            const x0 = it.ax - it.w / 2 + sx * it.w;
            const y0 = below ? it.ay + leader * 0.7 + sy * it.h : it.ay - leader - it.h - sy * it.h;
            const x = clampX(x0, it.w), y = clampY(y0, it.h);
            const r = { x, y, w: it.w, h: it.h };
            if (placed.some(p => overlaps(r, p, pad))) continue;
            if (dots.some(d => overlaps(r, d, pad * 0.5))) continue;
            const score = Math.abs(sx) * 2 + sy * 1.3 + (below ? 6 : 0)
              + Math.abs(x - x0) / it.w * 2 + Math.abs(y - y0) / it.h * 1.5;
            if (score < bestScore) { bestScore = score; best = r; }
          }
        }
        if (best && bestScore < 6) break;
      }
      if (!best) best = { x: clampX(it.ax - it.w / 2, it.w), y: clampY(it.ay - leader - it.h, it.h), w: it.w, h: it.h };
      out[it.id] = best;
      placed.push(best);
    }
    return out;
  }

  DT.layout = { autoLayout };
})(window.DT = window.DT || {});
