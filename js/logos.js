// Turns any dropped image (school logo, highway shield…) into a callout icon.
// Two versions are kept:
//  - "glyph": a one-color white silhouette that sits on the colored icon tile,
//    matching the built-in icons.
//  - "badge": the original colors on a white tile (best for highway shields).
(function (DT) {
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function processLogo(file) {
    const url = URL.createObjectURL(file);
    let img;
    try { img = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const s = Math.min(N / img.width, N / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (N - w) / 2, (N - h) / 2, w, h);
    const data = ctx.getImageData(0, 0, N, N);
    const px = data.data;

    // Work out the background: transparent, or the color of the corners.
    const cornerIdx = [[2, 2], [N - 3, 2], [2, N - 3], [N - 3, N - 3]]
      .map(([x, y]) => ((y * N + x) * 4));
    // Pixels outside the drawn image are transparent, so sample inside it.
    const ix0 = Math.ceil((N - w) / 2) + 1, iy0 = Math.ceil((N - h) / 2) + 1;
    const ix1 = Math.floor((N + w) / 2) - 2, iy1 = Math.floor((N + h) / 2) - 2;
    const inner = [[ix0, iy0], [ix1, iy0], [ix0, iy1], [ix1, iy1]].map(([x, y]) => ((y * N + x) * 4));
    const transparentBg = inner.some(i => px[i + 3] < 200);
    let bg = [255, 255, 255];
    if (!transparentBg) {
      bg = [0, 1, 2].map(k => inner.reduce((sum, i) => sum + px[i + k], 0) / 4);
    }
    void cornerIdx;

    // Build the silhouette mask and find the content bounds.
    const mask = new Uint8ClampedArray(N * N);
    let minX = N, minY = N, maxX = -1, maxY = -1;
    for (let i = 0; i < N * N; i++) {
      const a = px[i * 4 + 3];
      let m;
      if (transparentBg) m = a;
      else {
        const d = Math.hypot(px[i * 4] - bg[0], px[i * 4 + 1] - bg[1], px[i * 4 + 2] - bg[2]);
        m = Math.max(0, Math.min(255, (d - 28) * 4)) * (a / 255);
      }
      mask[i] = m;
      if (m > 40) {
        const x = i % N, y = (i / N) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) { minX = 0; minY = 0; maxX = N - 1; maxY = N - 1; }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;

    const OUT = 160;
    const make = (fill) => {
      const o = document.createElement('canvas');
      o.width = o.height = OUT;
      const octx = o.getContext('2d');
      const tmp = document.createElement('canvas');
      tmp.width = bw; tmp.height = bh;
      const tctx = tmp.getContext('2d');
      const id = tctx.createImageData(bw, bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const si = (y + minY) * N + (x + minX), di = (y * bw + x) * 4;
        if (fill === 'white') {
          id.data[di] = id.data[di + 1] = id.data[di + 2] = 255;
          id.data[di + 3] = mask[si];
        } else {
          id.data[di] = px[si * 4]; id.data[di + 1] = px[si * 4 + 1]; id.data[di + 2] = px[si * 4 + 2];
          id.data[di + 3] = transparentBg ? px[si * 4 + 3] : 255;
        }
      }
      tctx.putImageData(id, 0, 0);
      const k = Math.min(OUT / bw, OUT / bh);
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(tmp, (OUT - bw * k) / 2, (OUT - bh * k) / 2, bw * k, bh * k);
      return o.toDataURL('image/png');
    };

    return {
      id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: file.name.replace(/\.[^.]+$/, ''),
      glyph: make('white'),
      badge: make('color'),
      mode: 'glyph',
    };
  }

  DT.logos = { processLogo, loadImage };
})(window.DT = window.DT || {});
