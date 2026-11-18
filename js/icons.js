// Built-in callout icons. Each icon is drawn in a 24x24 box as one or more
// parts: filled shapes ("fill") or lines ("stroke").
(function (DT) {
  const ICONS = {
    school: { label: 'School', parts: [
      { d: 'M12 3 1 9l11 6 9-4.91V17h2V9L12 3z' },
      { d: 'M5 13.2v4L12 21l7-3.8v-4L12 17l-7-3.8z' } ] },
    highway: { label: 'Highway', parts: [
      { d: 'M9 2h6l7 20H2L9 2zM11.3 4.2h1.4v3h-1.4zM11.1 9.6h1.8v3.8h-1.8zM10.9 15.6h2.2v4.6h-2.2z', rule: 'evenodd' } ] },
    water: { label: 'Water', parts: [
      { d: 'M2 7.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2', stroke: 2.2 },
      { d: 'M2 12.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2', stroke: 2.2 },
      { d: 'M2 17.5c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2', stroke: 2.2 } ] },
    park: { label: 'Park', parts: [
      { d: 'M12 2a6 6 0 0 0-6 6c0 1.2.36 2.3.97 3.2A5 5 0 0 0 9 20h2v2.5h2V20h2a5 5 0 0 0 2.03-8.8A6 6 0 0 0 12 2z' } ] },
    shop: { label: 'Shopping', parts: [
      { d: 'M5.2 7.5h13.6L20 21.5H4L5.2 7.5z' },
      { d: 'M8.8 10V6.5a3.2 3.2 0 0 1 6.4 0V10', stroke: 2 } ] },
    child: { label: 'Preschool', parts: [
      { d: 'M2.5 12.5h8.5V21H2.5zM13 12.5h8.5V21H13zM7.75 3h8.5v8.2h-8.5z' } ] },
    home: { label: 'Home', parts: [ { d: 'M12 3 2 12h3v9h5.5v-6h3v6H19v-9h3L12 3z' } ] },
    star: { label: 'Star', parts: [
      { d: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z' } ] },
    hospital: { label: 'Hospital', parts: [ { d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z' } ] },
    golf: { label: 'Golf', parts: [
      { d: 'M7 2.5v19', stroke: 2.2 },
      { d: 'M8 3l11 4.2L8 11.4z' },
      { d: 'M3 21.5c1.5-1.6 6.5-2.4 9-2.4s5.5.5 9 2.4', stroke: 1.8 } ] },
    dining: { label: 'Dining', parts: [
      { d: 'M6 2v7a2.5 2.5 0 0 0 2 2.45V22h2V11.45A2.5 2.5 0 0 0 12 9V2h-1.5v6h-1V2h-1v6h-1V2z' },
      { d: 'M16 2c2.2 0 3.5 2.5 3.5 6 0 2.2-1 3.4-2 3.8V22h-2V2.2c.17-.13.33-.2.5-.2z' } ] },
    building: { label: 'Building', parts: [
      { d: 'M4 21.5V3h10v5h6v13.5H4zM6.5 5.5v2h2v-2zm3.5 0v2h2v-2zM6.5 9.5v2h2v-2zm3.5 0v2h2v-2zm5.5 1v2h2v-2zM6.5 13.5v2h2v-2zm3.5 0v2h2v-2zm5.5 1v2h2v-2zM9 18v3.5h2.5V18z', rule: 'evenodd' } ] },
    plane: { label: 'Airport', parts: [
      { d: 'M21.5 15.5v-2l-8-5V3.2a1.5 1.5 0 0 0-3 0v5.3l-8 5v2l8-2.5v5.5l-2 1.5v1.5l3.5-1 3.5 1v-1.5l-2-1.5V13z' } ] },
    pool: { label: 'Pool', parts: [
      { d: 'M8 15V5.5a2 2 0 0 1 4 0M14 15V5.5a2 2 0 0 1 4 0M8 8.5h6M8 12h6', stroke: 2 },
      { d: 'M2 18c2.5 0 2.5-1.8 5-1.8s2.5 1.8 5 1.8 2.5-1.8 5-1.8 2.5 1.8 5 1.8', stroke: 2 },
      { d: 'M2 21.5c2.5 0 2.5-1.8 5-1.8s2.5 1.8 5 1.8 2.5-1.8 5-1.8 2.5 1.8 5 1.8', stroke: 2 } ] },
    landmark: { label: 'Landmark', parts: [
      { d: 'M12 2 2 7v2.5h20V7L12 2zM4 11h2.6v7H4zm4.8 0h2.6v7H8.8zm4.8 0h2.6v7h-2.6zm4.8 0H21v7h-2.6zM2 19.2h20v2.6H2z' } ] },
    stadium: { label: 'Stadium', parts: [
      { d: 'M12 4C6.5 4 2 6.2 2 9v6c0 2.8 4.5 5 10 5s10-2.2 10-5V9c0-2.8-4.5-5-10-5zm0 2.2c4.4 0 7.6 1.6 7.6 2.8S16.4 11.8 12 11.8 4.4 10.2 4.4 9 7.6 6.2 12 6.2z', rule: 'evenodd' } ] },
    skyline: { label: 'Skyline', parts: [
      { d: 'M2 21.5V12h3v-2h2v11.5h1V6h4V3h2v3h1v15.5h1V9h4v4h2v8.5z' } ] },
    trail: { label: 'Trail', parts: [
      { d: 'M13.5 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 8.2l3-1 2.2 3.3 3 1-.6 1.9-3.8-1.3-.9-1.4-1 3.6 2.6 2.5V22h-2v-5.3l-2.4-2.2-1 4.4L6 22l-1.5-1.4 2.6-2.9L9.5 9.6 8 10.3V13H6V9z' } ] },
    boat: { label: 'Boat', parts: [
      { d: 'M11 2.5h1.5v11H11zM12.5 3l6.5 9.5h-6.5zM10 5.5 5 12.5h5z' },
      { d: 'M2.5 15h19l-2.8 4.5H5.3z' },
      { d: 'M2 21.8c2.5 0 2.5-1.3 5-1.3s2.5 1.3 5 1.3 2.5-1.3 5-1.3 2.5 1.3 5 1.3', stroke: 1.6 } ] },
    church: { label: 'Church', parts: [
      { d: 'M11 1.5h2v2.3h2.2v2H13v2.4l5 3.6v10.7h-4.5V17a1.5 1.5 0 0 0-3 0v4.5H6V11.8l5-3.6V5.8H8.8v-2H11z' } ] },
    book: { label: 'Library', parts: [
      { d: 'M3 4.5c3-.4 5.9.2 8 1.8v14.2c-2.1-1.5-5-2.1-8-1.7zM21 4.5c-3-.4-5.9.2-8 1.8v14.2c2.1-1.5 5-2.1 8-1.7z' } ] },
    pin: { label: 'Pin', parts: [
      { d: 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z', rule: 'evenodd' } ] },
  };

  const pathCache = new Map();
  function path(d) {
    if (!pathCache.has(d)) pathCache.set(d, new Path2D(d));
    return pathCache.get(d);
  }

  // Draw a built-in icon in a square at (x, y) of the given size.
  function drawBuiltin(ctx, key, x, y, size, color) {
    const icon = ICONS[key] || ICONS.star;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of icon.parts) {
      if (p.stroke) { ctx.lineWidth = p.stroke; ctx.stroke(path(p.d)); }
      else ctx.fill(path(p.d), p.rule || 'nonzero');
    }
    ctx.restore();
  }

  // Same icon as inline SVG markup, for the sidebar and pickers.
  function svg(key, color = '#fff') {
    const icon = ICONS[key] || ICONS.star;
    const parts = icon.parts.map(p => p.stroke
      ? `<path d="${p.d}" fill="none" stroke="${color}" stroke-width="${p.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="${p.d}" fill="${color}" fill-rule="${p.rule || 'nonzero'}"/>`).join('');
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${parts}</svg>`;
  }

  DT.icons = { ICONS, drawBuiltin, svg };
})(window.DT = window.DT || {});
