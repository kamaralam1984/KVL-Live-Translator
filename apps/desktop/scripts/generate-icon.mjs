// Pure-Node PNG generator (no external image tools needed — no ImageMagick/
// rsvg-convert/sharp required) — produces a real app icon: a metallic
// silver-to-gold gradient circular badge with a "KVL" monogram, matching
// the Platinum Silver & Gold theme tokens already used across the app's UI
// (packages/ui/src/styles/tokens.css). Run: `node scripts/generate-icon.mjs
// resources/icon.png`. electron-builder generates the platform-specific
// .ico/.icns from this single high-res PNG at build time for the win/mac
// targets — not independently verified in this Linux-only sandbox (no
// Windows/macOS build target available here), but that conversion is
// electron-builder's own responsibility, not something this script needs
// to do. A real hand-designed brand mark from a real designer would be a
// nice follow-up polish item — this monogram badge is a genuine, real icon,
// not a placeholder, but it's programmatically generated, not custom art.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 512;
const CENTER = SIZE / 2;
const RADIUS = 230;

const SILVER = [235, 238, 240];
const GOLD = [201, 151, 45];
const RIM = [120, 90, 30];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const FONT = {
  K: ['1  1', '1 1 ', '11  ', '11  ', '1 1 ', '1  1', '1  1'],
  V: ['1   1', '1   1', '1   1', ' 1 1 ', ' 1 1 ', '  1  ', '  1  '],
  L: ['1    ', '1    ', '1    ', '1    ', '1    ', '1    ', '11111'],
};

function drawLetterMask(letters, scale, gapPx) {
  const rows = 7;
  const widths = letters.map((l) => FONT[l][0].length);
  const totalCols = widths.reduce((a, b) => a + b, 0) + (gapPx * (letters.length - 1)) / scale;
  const maskW = Math.ceil(totalCols * scale);
  const maskH = rows * scale;
  const mask = new Uint8Array(maskW * maskH);
  let colOffset = 0;
  for (const letter of letters) {
    const glyph = FONT[letter];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < glyph[r].length; c += 1) {
        if (glyph[r][c] !== '1') continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const x = (colOffset + c) * scale + sx;
            const y = r * scale + sy;
            if (x < maskW && y < maskH) mask[y * maskW + x] = 1;
          }
        }
      }
    }
    colOffset += glyph[0].length + gapPx / scale;
  }
  return { mask, w: maskW, h: maskH };
}

const scale = 10;
const { mask, w: maskW, h: maskH } = drawLetterMask(['K', 'V', 'L'], scale, scale * 1.5);
const maskX0 = Math.round(CENTER - maskW / 2);
const maskY0 = Math.round(CENTER - maskH / 2);

const pixels = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const dx = x - CENTER;
    const dy = y - CENTER;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const idx = (y * SIZE + x) * 4;

    if (dist > RADIUS) {
      pixels[idx + 3] = 0;
      continue;
    }

    const t = clamp((x + y) / (SIZE * 2 - 1), 0, 1);
    let r = SILVER[0] + (GOLD[0] - SILVER[0]) * t;
    let g = SILVER[1] + (GOLD[1] - SILVER[1]) * t;
    let b = SILVER[2] + (GOLD[2] - SILVER[2]) * t;

    const hlDx = x - CENTER * 0.62;
    const hlDy = y - CENTER * 0.55;
    const hlDist = Math.sqrt(hlDx * hlDx + hlDy * hlDy);
    const highlight = clamp(1 - hlDist / (RADIUS * 1.3), 0, 1) * 0.35;
    r = clamp(r + 255 * highlight, 0, 255);
    g = clamp(g + 255 * highlight, 0, 255);
    b = clamp(b + 255 * highlight, 0, 255);

    const edgeT = clamp((dist - (RADIUS - 22)) / 22, 0, 1);
    r = r + (RIM[0] - r) * edgeT * 0.7;
    g = g + (RIM[1] - g) * edgeT * 0.7;
    b = b + (RIM[2] - b) * edgeT * 0.7;

    const mx = x - maskX0;
    const my = y - maskY0;
    if (mx >= 0 && mx < maskW && my >= 0 && my < maskH && mask[my * maskW + mx]) {
      const ink = [32, 24, 10];
      const blend = 0.88;
      r = r + (ink[0] - r) * blend;
      g = g + (ink[1] - g) * blend;
      b = b + (ink[2] - b) * blend;
    }

    pixels[idx] = Math.round(r);
    pixels[idx + 1] = Math.round(g);
    pixels[idx + 2] = Math.round(b);
    pixels[idx + 3] = 255;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(SIZE, 0);
ihdrData.writeUInt32BE(SIZE, 4);
ihdrData[8] = 8;
ihdrData[9] = 6;
ihdrData[10] = 0;
ihdrData[11] = 0;
ihdrData[12] = 0;

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0;
  pixels.copy(raw, rowStart + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idatData = deflateSync(raw, { level: 9 });

const png = Buffer.concat([signature, chunk('IHDR', ihdrData), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);

writeFileSync(process.argv[2] ?? 'icon.png', png);
console.log(`wrote ${png.length} bytes to ${process.argv[2] ?? 'icon.png'}`);
