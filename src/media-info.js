// Reads width and height from the start of a JPEG, PNG, GIF or WebP file, so the
// timeline can reserve space for a photo before it has downloaded. Returns null if
// the size can't be found (videos, unusual files); that is not an error.

export function imageSize(bytes) {
  const b = bytes;
  const u16be = i => (b[i] << 8) | b[i + 1];
  const u32be = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const u16le = i => b[i] | (b[i + 1] << 8);
  if (b.length < 24) return null;

  // PNG: width and height are in the IHDR chunk.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32be(16), height: u32be(20) };
  }
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(6), height: u16le(8) };
  }
  // WebP
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === 'VP8L') {
      const n = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xff) { i++; continue; }
      const len = u16be(i + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        const size = { width: u16be(i + 7), height: u16be(i + 5) };
        const turn = jpegOrientation(b);
        return turn >= 5 ? { width: size.height, height: size.width } : size;
      }
      i += 2 + len;
    }
  }
  return null;
}

// EXIF orientation 5–8 means the photo is shown rotated a quarter turn, so the
// displayed width and height are swapped. Returns 1 (normal) if there's no EXIF.
function jpegOrientation(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, le = b[t] === 0x49;
      const r16 = j => le ? b[j] | (b[j + 1] << 8) : (b[j] << 8) | b[j + 1];
      const r32 = j => le ? (b[j] | (b[j + 1] << 8) | (b[j + 2] << 16) | (b[j + 3] << 24)) >>> 0
        : ((b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3]) >>> 0;
      const ifd = t + r32(t + 4), n = r16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) break;
        if (r16(e) === 0x0112) return r16(e + 8);
      }
      return 1;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}
