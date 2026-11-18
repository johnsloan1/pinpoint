// Reads the camera information stored inside a DJI photo.
// - Standard EXIF (focal length, GPS) is read with the exifr library.
// - DJI's camera direction (gimbal yaw/pitch/roll, height above takeoff)
//   lives in XMP metadata under the "drone-dji" namespace. We pull the XMP
//   text straight out of the JPEG and read it ourselves.
(function (DT) {
  function extractXmp(buffer) {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return '';
    const dec = new TextDecoder('utf-8');
    const STD = 'http://ns.adobe.com/xap/1.0/\0';
    const EXT = 'http://ns.adobe.com/xmp/extension/\0';
    let off = 2, out = '';
    while (off + 4 < view.byteLength) {
      if (view.getUint8(off) !== 0xFF) { off++; continue; }
      const marker = view.getUint8(off + 1);
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break; // image data starts
      const len = view.getUint16(off + 2);
      if (marker === 0xE1) {
        const start = off + 4;
        const head = String.fromCharCode(...new Uint8Array(buffer, start, Math.min(40, len - 2)));
        if (head.startsWith(STD)) {
          out += dec.decode(new Uint8Array(buffer, start + STD.length, len - 2 - STD.length));
        } else if (head.startsWith(EXT)) {
          const skip = EXT.length + 32 + 8; // GUID + full length + offset
          out += dec.decode(new Uint8Array(buffer, start + skip, len - 2 - skip));
        }
      }
      off += 2 + len;
    }
    return out;
  }

  function xmpValue(xmp, ns, name) {
    const attr = new RegExp(ns + ':' + name + '\\s*=\\s*"([^"]*)"').exec(xmp);
    if (attr) return attr[1];
    const el = new RegExp('<' + ns + ':' + name + '>([^<]*)<').exec(xmp);
    return el ? el[1] : null;
  }
  function xmpNum(xmp, ns, name) {
    const v = xmpValue(xmp, ns, name);
    if (v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  async function readMeta(file) {
    const buffer = await file.arrayBuffer();
    let xmp = '';
    try { xmp = extractXmp(buffer); } catch (e) { console.warn('XMP read failed', e); }

    let ex = {};
    try {
      ex = (await window.exifr.parse(buffer, {
        tiff: true, exif: true, gps: true, xmp: false, iptc: false, icc: false, jfif: false, ihdr: false,
      })) || {};
    } catch (e) { console.warn('EXIF read failed', e); }

    const d = (k) => xmpNum(xmp, 'drone-dji', k);
    const dji = {
      lat: d('GpsLatitude'),
      lon: d('GpsLongitude') ?? d('GpsLongtitude'), // some DJI firmware misspells this
      absAlt: d('AbsoluteAltitude'),
      relAlt: d('RelativeAltitude'),
      yaw: d('GimbalYawDegree'),
      pitch: d('GimbalPitchDegree'),
      roll: d('GimbalRollDegree'),
      flightYaw: d('FlightYawDegree'),
    };

    // Lightroom crop, if Lightroom wrote its develop settings into the export.
    let crop = null;
    const hasCrop = xmpValue(xmp, 'crs', 'HasCrop');
    if (hasCrop && /true/i.test(hasCrop)) {
      const c = (k) => xmpNum(xmp, 'crs', k);
      const l = c('CropLeft'), t = c('CropTop'), r = c('CropRight'), b = c('CropBottom');
      if ([l, t, r, b].every(v => v != null) && r > l && b > t && (r - l < 0.999 || b - t < 0.999)) {
        crop = { l, t, r, b, angle: c('CropAngle') || 0 };
      }
    }

    const lat = dji.lat ?? ex.latitude ?? null;
    const lon = dji.lon ?? ex.longitude ?? null;
    return {
      make: ex.Make || (xmp.includes('drone-dji') ? 'DJI' : null),
      model: ex.Model || null,
      date: ex.DateTimeOriginal ? new Date(ex.DateTimeOriginal).toISOString() : null,
      f35: ex.FocalLengthIn35mmFormat || null,
      focal: ex.FocalLength || null,
      digitalZoom: ex.DigitalZoomRatio || null,
      lat, lon,
      hasGps: lat != null && lon != null,
      relAlt: dji.relAlt,
      absAlt: dji.absAlt ?? ex.GPSAltitude ?? null,
      yaw: dji.yaw, pitch: dji.pitch, roll: dji.roll ?? 0,
      flightYaw: dji.flightYaw,
      hasDjiXmp: xmp.includes('drone-dji'),
      hasDirection: dji.yaw != null && dji.pitch != null,
      hasHeight: dji.relAlt != null,
      crop,
    };
  }

  DT.metadata = { readMeta, extractXmp };
})(window.DT = window.DT || {});
