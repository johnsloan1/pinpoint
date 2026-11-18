// Lot-line masks: parts of a photo (house, trees…) drawn back on top of the
// lot lines, so the lines look like they pass behind them. Callouts are
// unaffected. A mask is stored per photo as a small black-and-white PNG.
//
// "Smart select" uses Segment Anything (SlimSAM, Apache-2.0) running in the
// browser. Nothing is downloaded until you first pick that tool; the photo
// never leaves your computer.
(function (DT) {
  const MAX = 2048; // mask resolution (long side)

  function maskSize(W, H) {
    const k = Math.min(1, MAX / Math.max(W, H));
    return { w: Math.round(W * k), h: Math.round(H * k), k };
  }
  function blank(W, H) {
    const { w, h } = maskSize(W, H);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function copy(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  // Saved PNG → canvas (decoded once, remembered).
  const decoded = new Map();
  function fromData(url, onReady) {
    if (!url) return null;
    const c = decoded.get(url);
    if (c && c !== 'loading') return c;
    if (!c) {
      decoded.set(url, 'loading');
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        cv.getContext('2d').drawImage(img, 0, 0);
        decoded.set(url, cv);
        if (decoded.size > 60) decoded.delete(decoded.keys().next().value);
        onReady && onReady();
      };
      img.onerror = () => decoded.delete(url);
      img.src = url;
    }
    return null;
  }
  function remember(url, canvas) { decoded.set(url, copy(canvas)); }
  // Same, but waits (used for export).
  function load(url) {
    const c = decoded.get(url);
    if (c && c !== 'loading') return Promise.resolve(c);
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0); decoded.set(url, cv); res(cv); };
      img.onerror = () => rej(new Error('mask could not be read'));
      img.src = url;
    });
  }

  // Coloured see-through version of a mask, for showing it while editing.
  const tints = new WeakMap();
  function tint(mask, color, ver = 0) {
    const t = tints.get(mask);
    if (t && t.color === color && t.ver === ver) return t.canvas;
    const c = (t && t.canvas) || document.createElement('canvas');
    c.width = mask.width; c.height = mask.height;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(mask, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    tints.set(mask, { color, ver, canvas: c });
    return c;
  }
  const isEmpty = (mask) => {
    const d = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
    for (let i = 3; i < d.length; i += 16) if (d[i]) return false;
    return true;
  };

  // ---------- Smart select (Segment Anything) ----------
  const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
  const MODEL = 'Xenova/slimsam-77-uniform';
  let samP = null;
  function loadSam(onStatus) {
    if (!samP) {
      samP = (async () => {
        onStatus && onStatus('Downloading smart select (about 14 MB, first time only)…');
        const T = await import(LIB);
        const opts = { dtype: 'q8' };
        const [model, processor] = await Promise.all([T.SamModel.from_pretrained(MODEL, opts), T.AutoProcessor.from_pretrained(MODEL)]);
        return { T, model, processor };
      })().catch((e) => { samP = null; throw e; });
    }
    return samP;
  }
  const prepared = new Map(); // photo key -> Promise<{ inputs, emb, w, h }>
  async function prepare(key, bitmap, onStatus) {
    if (prepared.has(key)) return prepared.get(key);
    const p = (async () => {
      const { T, model, processor } = await loadSam(onStatus);
      onStatus && onStatus('Studying this photo for smart select (a few seconds)…');
      const k = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
      c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const url = URL.createObjectURL(blob);
      try {
        const image = await T.RawImage.fromURL(url);
        const inputs = await processor(image);
        const emb = await model.get_image_embeddings(inputs);
        return { inputs, emb, w: c.width, h: c.height };
      } finally { URL.revokeObjectURL(url); }
    })().catch((e) => { prepared.delete(key); throw e; });
    prepared.set(key, p);
    if (prepared.size > 4) prepared.delete(prepared.keys().next().value);
    return p;
  }
  // Object under (fx, fy) (0..1 across/down the photo) → canvas mask.
  async function segment(key, bitmap, fx, fy) {
    const { T, model, processor } = await loadSam();
    const { inputs, emb, w, h } = await prepare(key, bitmap);
    const rs = inputs.reshaped_input_sizes[0]; // [height, width]
    const input_points = new T.Tensor('float32', [fx * rs[1], fy * rs[0]], [1, 1, 1, 2]);
    const input_labels = new T.Tensor('int64', [1n], [1, 1, 1]);
    const out = await model({ ...emb, input_points, input_labels });
    const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const m = masks[0]; // [1, 3, H, W]
    const [, n, H, W] = m.dims;
    const scores = out.iou_scores.data;
    // Of the three guesses, prefer the best-scoring one that isn't the whole
    // photo (sky, the whole neighborhood…).
    let best = 0, bestScore = -1;
    for (let i = 0; i < n; i++) {
      let on = 0;
      for (let j = i * W * H; j < (i + 1) * W * H; j += 7) on += m.data[j] ? 1 : 0;
      const frac = on / (W * H / 7);
      const s = scores[i] - (frac > 0.35 ? 1 : 0);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const img = x.createImageData(W, H);
    const off = best * W * H;
    for (let j = 0; j < W * H; j++) if (m.data[off + j]) { img.data[j * 4] = img.data[j * 4 + 1] = img.data[j * 4 + 2] = img.data[j * 4 + 3] = 255; }
    x.putImageData(img, 0, 0);
    return c;
  }

  DT.mask = { maskSize, blank, copy, fromData, load, remember, tint, isEmpty, loadSam, prepare, segment };
})(window.DT = window.DT || {});
