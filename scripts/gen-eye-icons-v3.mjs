// 眼睛形态方案原型：A=明眸大眼+睫毛（工作）/ B=眯眼+睫毛下垂（提醒）/ C=闭眼弧线+睫毛（休息）/ D=半睁中性（未开始）
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'eye-proto');
mkdirSync(outDir, { recursive: true });

const SIZE = 44;
const CX = SIZE / 2;
const CY = SIZE / 2;

// CRC32 表必须最先初始化（生成循环在文件末尾执行时会用到）
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

// 方案 A：明眸大眼 + 睫毛（工作中）
function drawWideOpen() {
  const rx = 19, ry = 13;
  const upperLid = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const x = CX - rx + t * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2);
    upperLid.push([x, y]);
  }
  const lashLen = 4;
  const lashAngles = [-0.9, -0.45, 0, 0.45, 0.9];
  const lashes = [];
  for (const angle of lashAngles) {
    const t = 0.5 + angle * 0.35;
    const x = CX - rx + t * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2);
    const rad = angle * 0.6 - Math.PI / 2;
    lashes.push([[x, y], [x + Math.cos(rad) * lashLen, y + Math.sin(rad) * lashLen]]);
  }
  const lowerLid = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const x = CX - rx + t * 2 * rx;
    const y = CY + ry * Math.sqrt(1 - ((x - CX) / rx) ** 2);
    lowerLid.push([x, y]);
  }
  const pupilR = 7;
  return { upperLid, lowerLid, lashes, pupilR, pupilY: CY };
}

// 方案 B：眯眼 + 睫毛下垂（该休息了）
function drawSquint() {
  const rx = 19, ry = 8;
  const upperLid = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const x = CX - rx + t * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2) - 1;
    upperLid.push([x, y]);
  }
  const lashLen = 3;
  const lashAngles = [-0.8, -0.4, 0, 0.4, 0.8];
  const lashes = [];
  for (const angle of lashAngles) {
    const t = 0.5 + angle * 0.35;
    const x = CX - rx + t * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2) - 1;
    const rad = angle * 0.5 - Math.PI / 2 + 0.3;
    lashes.push([[x, y], [x + Math.cos(rad) * lashLen, y + Math.sin(rad) * lashLen]]);
  }
  const lowerLid = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const x = CX - rx + t * 2 * rx;
    const y = CY + ry * Math.sqrt(1 - ((x - CX) / rx) ** 2) + 2;
    lowerLid.push([x, y]);
  }
  const pupilR = 4.5;
  return { upperLid, lowerLid, lashes, pupilR, pupilY: CY + 1 };
}

// 方案 C：闭眼弧线 + 睫毛（休息中）
function drawClosed() {
  const rx = 19;
  const closedLid = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const x = CX - rx + t * 2 * rx;
    const y = CY - 3 + Math.sin(t * Math.PI) * 2;
    closedLid.push([x, y]);
  }
  const lashLen = 4;
  const lashAngles = [-0.8, -0.4, 0, 0.4, 0.8];
  const lashes = [];
  for (const angle of lashAngles) {
    const t = 0.5 + angle * 0.35;
    const x = CX - rx + t * 2 * rx;
    const y = CY - 3 + Math.sin(t * Math.PI) * 2;
    const rad = Math.PI / 2 + angle * 0.3;
    lashes.push([[x, y], [x + Math.cos(rad) * lashLen, y + Math.sin(rad) * lashLen]]);
  }
  return { upperLid: closedLid, lowerLid: [], lashes, pupilR: 0, pupilY: CY };
}

// 方案 D：半睁中性（未开始）
function drawHalfOpen() {
  const rx = 19, ry = 10;
  const upperLid = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const x = CX - rx + t * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2);
    upperLid.push([x, y]);
  }
  const lowerLid = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const x = CX - rx + t * 2 * rx;
    const y = CY + ry * Math.sqrt(1 - ((x - CX) / rx) ** 2) * 0.6;
    lowerLid.push([x, y]);
  }
  const pupilR = 5;
  return { upperLid, lowerLid, lashes: [], pupilR, pupilY: CY };
}

const protos = {
  'A-明眸大眼': drawWideOpen,
  'B-眯眼': drawSquint,
  'C-闭眼': drawClosed,
  'D-半睁': drawHalfOpen,
};

// 生成
for (const [name, drawFn] of Object.entries(protos)) {
  const { upperLid, lowerLid, lashes, pupilR, pupilY } = drawFn();
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let alpha = 0;
      let r = 0, g = 0, b = 0;

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
      for (const [[x1, y1], [x2, y2]] of lashes) {
        const d = Math.min(
          Math.hypot(px - x1, py - y1),
          Math.hypot(px - x2, py - y2),
          Math.hypot(px - (x1 + x2) / 2, py - (y1 + y2) / 2)
        );
        if (d < 2) alpha = Math.max(alpha, Math.min(1, (2 - d) / 2) * 0.9);
      }
      if (pupilR > 0) {
        const pd = Math.hypot(px - CX, py - pupilY);
        if (pd <= pupilR) {
          alpha = Math.max(alpha, 0.95);
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
  writeFileSync(join(outDir, `${name}.png`), png);
  console.log('ok', name);
}
