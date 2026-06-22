// Generates media/icon.png — a 128x128 PNG marketplace icon (no external deps).
// Indigo rounded square with a white git-merge glyph (two branches -> one node).
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 128;
const buf = Buffer.alloc(SIZE * SIZE * 4); // RGBA

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // simple source-over alpha blend
  const sa = a / 255;
  buf[i]     = Math.round(r * sa + buf[i]     * (1 - sa));
  buf[i + 1] = Math.round(g * sa + buf[i + 1] * (1 - sa));
  buf[i + 2] = Math.round(b * sa + buf[i + 2] * (1 - sa));
  buf[i + 3] = Math.max(buf[i + 3], a);
}

// Rounded-square background
const RAD = 26;
function inRounded(x, y) {
  const minX = 0, minY = 0, maxX = SIZE - 1, maxY = SIZE - 1;
  const cxL = minX + RAD, cxR = maxX - RAD, cyT = minY + RAD, cyB = maxY - RAD;
  let dx = 0, dy = 0;
  if (x < cxL) dx = cxL - x; else if (x > cxR) dx = x - cxR;
  if (y < cyT) dy = cyT - y; else if (y > cyB) dy = y - cyB;
  return dx * dx + dy * dy <= RAD * RAD;
}
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inRounded(x, y)) {
      // subtle vertical gradient indigo -> violet
      const t = y / SIZE;
      const r = Math.round(0x5b + (0x7c - 0x5b) * t);
      const g = Math.round(0x3d + (0x4b - 0x3d) * t);
      const b = Math.round(0xe8 + (0xf4 - 0xe8) * t);
      setPx(x, y, r, g, b, 255);
    }
  }
}

// White glyph: nodes A (bottom-left), B (bottom-right), C (top), lines A->C, B->C
function disc(cx, cy, rad, r, g, b) {
  for (let y = -rad; y <= rad; y++)
    for (let x = -rad; x <= rad; x++)
      if (x * x + y * y <= rad * rad) setPx(cx + x, cy + y, r, g, b, 255);
}
function thickLine(x0, y0, x1, y1, w, r, g, b) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), Math.floor(w / 2), r, g, b);
  }
}
const A = [42, 92], B = [86, 92], C = [64, 40];
thickLine(A[0], A[1], C[0], C[1], 11, 255, 255, 255);
thickLine(B[0], B[1], C[0], C[1], 11, 255, 255, 255);
disc(A[0], A[1], 12, 255, 255, 255);
disc(B[0], B[1], 12, 255, 255, 255);
disc(C[0], C[1], 13, 255, 255, 255);
// re-color node centers indigo to make them rings (branch dots)
disc(A[0], A[1], 5, 0x5b, 0x3d, 0xe8);
disc(B[0], B[1], 5, 0x6a, 0x46, 0xee);
disc(C[0], C[1], 6, 0x74, 0x49, 0xf2);

// Encode PNG
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
const CRC_TABLE = (() => {
  const tbl = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[n] = c >>> 0;
  }
  return tbl;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, color type 6 (RGBA)
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
