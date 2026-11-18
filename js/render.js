// Drawing: callout boxes, leader lines, dots and the house pin. The same
// code draws the on-screen preview and the full-resolution export, so what
// you see is what you get.
(function (DT) {
  // All sizes in the style are "per 1000 pixels of photo width", so a
  // callout looks the same on a small preview and a 5000px export.
  function unit(W) { return W / 1000; }

  function fontString(style, size, weight) {
    return `${weight || style.fontWeight} ${size}px "${style.font}", system-ui, sans-serif`;
  }

  function metrics(ctx, item, style, u) {
    const fs = style.fontSize * u;
    const subFs = fs * 0.76;
    ctx.font = fontString(style, fs);
    const tw = ctx.measureText(item.title).width;
    let sw = 0;
    if (item.sub) { ctx.font = fontString(style, subFs, 500); sw = ctx.measureText(item.sub).width; }
    const padY = fs * 0.42, padX = fs * 0.45;
    const showIcon = style.showIcons !== false;
    const iconSize = showIcon ? (item.sub ? fs * 2.05 : fs * 1.6) : 0;
    const gap = showIcon ? fs * 0.55 : fs * 0.2;
    const textH = item.sub ? fs * 1.05 + subFs * 1.2 : fs * 1.15;
    const h = Math.max(iconSize, textH) + padY * 2;
    const w = padX + iconSize + gap + Math.max(tw, sw) + padX * 1.5;
    return { w, h, fs, subFs, padX, padY, iconSize, gap, textH };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function attachPoint(b, ax, ay) {
    const inset = Math.min(b.h * 0.5, b.w / 2);
    const cx = Math.max(b.x + inset, Math.min(b.x + b.w - inset, ax));
    if (ay >= b.y + b.h) return [cx, b.y + b.h];
    if (ay <= b.y) return [cx, b.y];
    return [ax < b.x + b.w / 2 ? b.x : b.x + b.w, Math.max(b.y, Math.min(b.y + b.h, ay))];
  }

  function dash(style, u) {
    const w = style.lineWidth * u;
    if (style.lineDash === 'dashed') return [w * 4, w * 3];
    if (style.lineDash === 'dotted') return [0.01, w * 2.2];
    return [];
  }

  function drawLine(ctx, it, style, u) {
    const [x, y] = attachPoint(it.box, it.ax, it.ay);
    ctx.save();
    ctx.strokeStyle = it.colors.line;
    ctx.lineWidth = style.lineWidth * u;
    ctx.lineCap = 'round';
    ctx.setLineDash(dash(style, u));
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 3 * u;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(it.ax, it.ay);
    ctx.stroke();
    ctx.restore();
  }

  function drawDot(ctx, it, style, u) {
    const r = style.dotSize * u;
    if (r <= 0) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 3 * u;
    ctx.beginPath();
    ctx.arc(it.ax, it.ay, r, 0, Math.PI * 2);
    ctx.fillStyle = it.colors.dot;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (style.dotRing > 0) {
      ctx.lineWidth = style.dotRing * u;
      ctx.strokeStyle = it.colors.dotRing;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawIconTile(ctx, it, x, y, size, style, logoImages) {
    const radius = style.iconShape === 'circle' ? size / 2 : size * 0.24;
    const logo = it.icon.startsWith('logo:') ? logoImages.get(it.icon.slice(5)) : null;
    if (logo && logo.mode === 'badge') {
      roundRect(ctx, x, y, size, size, radius);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      const inset = size * 0.08;
      drawContained(ctx, logo.img, x + inset, y + inset, size - inset * 2);
      return;
    }
    roundRect(ctx, x, y, size, size, radius);
    ctx.fillStyle = it.colors.iconBg;
    ctx.fill();
    const inset = size * 0.19;
    if (logo) drawContained(ctx, logo.img, x + inset, y + inset, size - inset * 2);
    else DT.icons.drawBuiltin(ctx, it.icon, x + inset, y + inset, size - inset * 2, it.colors.iconFg);
  }

  function drawContained(ctx, img, x, y, size) {
    if (!img || !img.width) return;
    const s = Math.min(size / img.width, size / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
  }

  function drawBox(ctx, it, style, u, logoImages) {
    const b = it.box, m = it.m;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = m.fs * 0.7;
    ctx.shadowOffsetY = m.fs * 0.12;
    roundRect(ctx, b.x, b.y, b.w, b.h, style.radius * u);
    ctx.fillStyle = it.colors.box;
    ctx.globalAlpha = style.boxOpacity ?? 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowColor = 'transparent';
    if (style.borderWidth > 0) {
      ctx.lineWidth = style.borderWidth * u;
      ctx.strokeStyle = it.colors.border;
      ctx.stroke();
    }
    if (m.iconSize) drawIconTile(ctx, it, b.x + m.padX, b.y + (b.h - m.iconSize) / 2, m.iconSize, style, logoImages);
    const tx = b.x + m.padX + m.iconSize + m.gap;
    const top = b.y + (b.h - m.textH) / 2;
    ctx.fillStyle = it.colors.text;
    ctx.textBaseline = 'alphabetic';
    ctx.font = fontString(style, m.fs);
    ctx.fillText(it.title, tx, top + m.fs * 0.86);
    if (it.sub) {
      ctx.font = fontString(style, m.subFs, 500);
      ctx.globalAlpha = 0.78;
      ctx.fillText(it.sub, tx, top + m.fs * 1.05 + m.subFs * 0.95);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // House pin. (x, y) is the point of the pin.
  function pinGeometry(x, y, style, u) {
    const H = style.pinSize * u, r = H * 0.36;
    return { H, r, cx: x, cy: y - H + r, rect: { x: x - r, y: y - H, w: r * 2, h: H } };
  }
  function drawPin(ctx, x, y, style, u) {
    const g = pinGeometry(x, y, style, u);
    const { r, cx, cy } = g;
    const D = y - cy;
    ctx.save();
    // ground shadow
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.5, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = r * 0.5;
    ctx.shadowOffsetY = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - r * 0.3, y - D * 0.4, cx - r, cy + r * 0.6, cx - r, cy);
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.bezierCurveTo(cx + r, cy + r * 0.6, x + r * 0.3, y - D * 0.4, x, y);
    ctx.closePath();
    ctx.fillStyle = style.pinColor;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = r * 0.12;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.56, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    DT.icons.drawBuiltin(ctx, 'home', cx - r * 0.38, cy - r * 0.4, r * 0.76, style.pinColor);
    ctx.restore();
    return g;
  }

  // Lot-line mask: the masked parts of the photo go back on top of the lot
  // lines (callouts stay in front).
  const maskedCache = new WeakMap();
  function maskedPhoto(image, mask, ver) {
    const c = maskedCache.get(image);
    if (c && c.mask === mask && c.ver === ver) return c.canvas;
    const cv = (c && c.canvas) || document.createElement('canvas');
    cv.width = image.width; cv.height = image.height;
    const x = cv.getContext('2d');
    x.clearRect(0, 0, cv.width, cv.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(mask, 0, 0, cv.width, cv.height);
    x.globalCompositeOperation = 'source-in';
    x.drawImage(image, 0, 0);
    x.globalCompositeOperation = 'source-over';
    maskedCache.set(image, { mask, ver, canvas: cv });
    return cv;
  }

  // Draw everything. scene comes from main.js (positions in photo pixels).
  function drawScene(ctx, scene, image, opts = {}) {
    const { W, H, style, items } = scene;
    const u = unit(W);
    if (image) ctx.drawImage(image, 0, 0, W, H);
    if (scene.lot) drawLot(ctx, scene.lot, style, u);
    if (scene.lot && image && opts.lotMask) ctx.drawImage(maskedPhoto(image, opts.lotMask, opts.lotMaskVer || 0), 0, 0, W, H);
    // While editing a mask: show it (and the smart-select guess) tinted.
    if (opts.maskTint) ctx.drawImage(opts.maskTint, 0, 0, W, H);
    if (opts.maskPreview) ctx.drawImage(opts.maskPreview, 0, 0, W, H);
    for (const it of items) drawLine(ctx, it, style, u);
    for (const it of items) drawDot(ctx, it, style, u);
    if (scene.house && style.showPin) drawPin(ctx, scene.house.x, scene.house.y, style, u);
    for (const it of items) drawBox(ctx, it, style, u, opts.logoImages || new Map());
    if (scene.notes && scene.notes.length) drawNotes(ctx, scene.notes, style, W, H, u);
    if (opts.lotHandles && scene.lot) drawLotHandles(ctx, scene.lot, opts.handleR || 7 * u, opts.lotSel);
    if (opts.drawPts && opts.drawPts.length) drawDraft(ctx, opts.drawPts, opts.handleR || 7 * u);

    // Selection outline (screen only, never exported)
    if (opts.selectedId) {
      ctx.save();
      ctx.setLineDash([6 * u, 4 * u]);
      ctx.lineWidth = 2.2 * u;
      ctx.strokeStyle = '#38bdf8';
      if (opts.selectedId === '__house' && scene.house) {
        const g = pinGeometry(scene.house.x, scene.house.y, style, u).rect;
        ctx.strokeRect(g.x - 4 * u, g.y - 4 * u, g.w + 8 * u, g.h + 8 * u);
      }
      const it = items.find(i => i.id === opts.selectedId);
      if (it) {
        roundRect(ctx, it.box.x - 4 * u, it.box.y - 4 * u, it.box.w + 8 * u, it.box.h + 8 * u, style.radius * u + 4 * u);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(it.ax, it.ay, style.dotSize * u + 6 * u, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Disclaimers ("*lot lines approximate", school note): white text with a
  // soft shadow, stacked in one corner.
  const NOTE_POS = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];
  function notesGeometry(ctx, lines, style, W, H, u) {
    const fs = (style.schoolNoteSize || 10) * u;
    ctx.font = fontString(style, fs, 600);
    const m = W * 0.018, h = fs * 1.25;
    const pos = NOTE_POS.includes(style.schoolNotePos) ? style.schoolNotePos : 'bottom-right';
    const bottom = pos.startsWith('bottom'), right = pos.endsWith('right');
    return lines.map((text, i) => {
      const w = ctx.measureText(text).width;
      const k = bottom ? lines.length - 1 - i : i; // first line farthest from the corner
      return { x: right ? W - m - w : m, y: bottom ? H - m - h * (k + 1) : m + h * k, w, h, fs, text };
    });
  }
  function drawNotes(ctx, lines, style, W, H, u) {
    for (const g of notesGeometry(ctx, lines, style, W, H, u)) {
      ctx.save();
      ctx.font = fontString(style, g.fs, 600);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = g.fs * 0.6;
      ctx.shadowOffsetY = g.fs * 0.08;
      ctx.fillText(g.text, g.x, g.y + g.h / 2);
      ctx.shadowBlur = g.fs * 0.25; // second pass: crisp edge on bright skies
      ctx.fillText(g.text, g.x, g.y + g.h / 2);
      ctx.restore();
    }
  }

  function hexToRgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  function drawLot(ctx, pts, style, u) {
    ctx.save();
    const n = pts.length;
    if (style.lotFill > 0) {
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = hexToRgba(style.lotColor, style.lotFill); ctx.fill();
    }
    // Lines, skipping deleted sides (p.gap = no line from p to the next corner).
    ctx.beginPath();
    const start = pts.findIndex(p => p.gap);
    if (start < 0) {
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
    } else {
      let pen = false;
      for (let k = 1; k <= n; k++) {
        const i = (start + k) % n, prev = pts[(i + n - 1) % n];
        if (prev.gap) { ctx.moveTo(pts[i].x, pts[i].y); pen = true; }
        else if (pen) ctx.lineTo(pts[i].x, pts[i].y);
      }
    }
    const lw = (style.lotWidth ?? 2.5) * u;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.setLineDash(style.lotDash === 'dashed' ? [lw * 4, lw * 2.5] : style.lotDash === 'dotted' ? [0.1, lw * 2.2] : []);
    ctx.lineCap = style.lotDash === 'dotted' || start >= 0 ? 'round' : 'butt';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = lw * 2;
    ctx.strokeStyle = style.lotColor || '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
  // Screen-only editing handles: corners, small "add a corner" dots, deleted
  // sides as faint dashes, and the selected corner or side in orange.
  function drawLotHandles(ctx, pts, r, lotSel) {
    ctx.save();
    const n = pts.length;
    pts.forEach((a, i) => {
      if (!a.gap) return;
      const b = pts[(i + 1) % n];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.setLineDash([r * 0.8, r * 0.8]); ctx.lineWidth = r * 0.3; ctx.strokeStyle = 'rgba(56,189,248,0.75)'; ctx.stroke();
    });
    ctx.setLineDash([]);
    if (lotSel && lotSel.edge != null && pts[lotSel.edge]) {
      const a = pts[lotSel.edge], b = pts[(lotSel.edge + 1) % n];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.lineWidth = r * 0.7; ctx.strokeStyle = 'rgba(249,115,22,0.9)';
      if (a.gap) ctx.setLineDash([r * 0.8, r * 0.8]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.lineWidth = r * 0.35;
    pts.forEach((a, i) => {
      if (a.gap) return;
      const b = pts[(i + 1) % n];
      ctx.beginPath(); ctx.arc((a.x + b.x) / 2, (a.y + b.y) / 2, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56,189,248,0.85)'; ctx.fill();
    });
    pts.forEach((p, i) => {
      const on = lotSel && lotSel.vertex === i;
      ctx.beginPath(); ctx.arc(p.x, p.y, on ? r * 1.25 : r, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#f97316' : '#ffffff'; ctx.fill(); ctx.strokeStyle = on ? '#ffffff' : '#38bdf8'; ctx.stroke();
    });
    ctx.restore();
  }
  function drawDraft(ctx, pts, r) {
    ctx.save();
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = r * 0.4; ctx.setLineDash([r, r * 0.7]);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
    ctx.setLineDash([]);
    for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.8, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }

  DT.render = { unit, metrics, drawScene, pinGeometry, notesGeometry };
})(window.DT = window.DT || {});
