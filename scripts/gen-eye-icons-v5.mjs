// 眼睛形态 v5：基于 iconfont「斜眼」风格，右眼特征（瞳孔偏左）、长睫毛、眼角尖
// A=工作（明眸大眼+长睫毛）/ B=提醒（眯眼+睫毛下垂）/ C=休息（闭眼+睫毛）/ D=未开始（半睁）
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'icons');
mkdirSync(outDir, { recursive: true });

const SIZE = 44;
const CX = SIZE / 2;
const CY = SIZE / 2;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rawRgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rawRgba, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 右眼特征：瞳孔偏左（CX-2）、外眼角（右侧）尖尖、睫毛从右上眼睑向外辐射且更长

function drawEye(rx, ry, pupilOffsetX, pupilR, lashLen, lashDroop, closed = false) {
  const upperLid = [];
  const lowerLid = [];

  if (closed) {
    // 闭眼：上下眼睑合并成一道弧线，两端收尖
    for (let t = 0; t <= 1; t += 0.01) {
      const tt = t < 0.5 ? t : 0.5 + (t - 0.5) * 1.15; // 右眼角更尖
      const x = CX - rx + tt * 2 * rx;
      const y = CY - 1 + Math.sin(tt * Math.PI) * 2.5;
      upperLid.push([x, y]);
    }
    // 睫毛：从弧线向下垂，长且清晰
    const lashes = [];
    const lashAngles = [-1.0, -0.5, 0, 0.5, 1.0];
    for (const angle of lashAngles) {
      const t = 0.5 + angle * 0.28;
      const x = CX - rx + t * 2 * rx;
      const y = CY - 1 + Math.sin(t * Math.PI) * 2.5;
      const rad = Math.PI / 2 + angle * 0.3; // 向下垂
      lashes.push([[x, y], [x + Math.cos(rad) * 7, y + Math.sin(rad) * 7]]);
    }
    return { upperLid, lowerLid: [], lashes, pupilR: 0, pupilY: CY, pupilOffsetX };
  }

  // 睁眼：上下眼睑分开
  for (let t = 0; t <= 1; t += 0.01) {
    const tt = t < 0.5 ? t : 0.5 + (t - 0.5) * 1.15;
    const x = CX - rx + tt * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2);
    upperLid.push([x, y]);
  }
  for (let t = 0; t <= 1; t += 0.01) {
    const tt = t < 0.5 ? t : 0.5 + (t - 0.5) * 1.15;
    const x = CX - rx + tt * 2 * rx;
    const y = CY + ry * Math.sqrt(1 - ((x - CX) / rx) ** 2) * 0.7;
    lowerLid.push([x, y]);
  }

  // 睫毛：从上眼睑向外辐射，长且翘
  const lashes = [];
  const lashAngles = [-1.0, -0.5, 0, 0.5, 1.0];
  for (const angle of lashAngles) {
    const t = 0.5 + angle * 0.28;
    const x = CX - rx + t * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2);
    const rad = angle * 0.5 - Math.PI / 2 + (angle > 0.4 ? 0.35 : 0) + lashDroop;
    lashes.push([[x, y], [x + Math.cos(rad) * lashLen, y + Math.sin(rad) * lashLen]]);
  }

  return { upperLid, lowerLid, lashes, pupilR, pupilY: CY, pupilOffsetX };
}

const icons = {
  'tray-working.png': () => drawEye(19, 14, -2, 7, 9, 0), // 工作：明眸大眼，睫毛最长最翘
  'tray-reminder.png': () => drawEye(19, 10, -1.5, 4.5, 8, 0.5), // 提醒：眯眼，睫毛下垂
  'tray-rest.png': () => drawEye(19, 0, 0, 0, 7, 0, true), // 休息：闭眼
  'tray-idle.png': () => drawEye(19, 11, -1.8, 5.5, 6, 0.1), // 未开始：半睁，无特别表情
};

for (const [name, drawFn] of Object.entries(icons)) {
  const { upperLid, lowerLid, lashes, pupilR, pupilY, pupilOffsetX } = drawFn();
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let alpha = 0;
      let r = 0, g = 0, b = 0;

      // 上眼睑描边
      for (let i = 0; i < upperLid.length - 1; i++) {
        const [x1, y1] = upperLid[i];
        const [x2, y2] = upperLid[i + 1];
        const d = Math.min(
          Math.hypot(px - x1, py - y1),
          Math.hypot(px - x2, py - y2),
          Math.hypot(px - (x1 + x2) / 2, py - (y1 + y2) / 2)
        );
        if (d < 2.5) alpha = Math.max(alpha, Math.min(1, (2.5 - d) / 2));
      }
      // 下眼睑描边
      for (let i = 0; i < lowerLid.length - 1; i++) {
        const [x1, y1] = lowerLid[i];
        const [x2, y2] = lowerLid[i + 1];
        const d = Math.min(
          Math.hypot(px - x1, py - y1),
          Math.hypot(px - x2, py - y2),
          Math.hypot(px - (x1 + x2) / 2, py - (y1 + y2) / 2)
        );
        if (d < 2.5) alpha = Math.max(alpha, Math.min(1, (2.5 - d) / 2));
      }
      // 睫毛
      for (const [[x1, y1], [x2, y2]] of lashes) {
        const d = Math.min(
          Math.hypot(px - x1, py - y1),
          Math.hypot(px - x2, py - y2),
          Math.hypot(px - (x1 + x2) / 2, py - (y1 + y2) / 2)
        );
        if (d < 2.2) alpha = Math.max(alpha, Math.min(1, (2.2 - d) / 2.2) * 0.95);
      }
      // 瞳孔（偏左，右眼特征）
      if (pupilR > 0) {
        const pd = Math.hypot(px - (CX + pupilOffsetX), py - pupilY);
        if (pd <= pupilR) {
          alpha = Math.max(alpha, 0.98);
          r = 30; g = 34; b = 42;
        }
      }

      if (alpha > 0) {
        row[1 + x * 4] = r;
        row[1 + x * 4 + 1] = g;
        row[1 + x * 4 + 2] = b;
        row[1 + x * 4 + 3] = Math.round(alpha * 255);
      }
    }
    rows.push(row);
  }
  const png = encodePng(Buffer.concat(rows));
  writeFileSync(join(outDir, name), png);
  console.log('ok', name);
}
