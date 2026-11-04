// 眼睛形态 v4：右眼（瞳孔偏左/外眼角在右）、睫毛更长、眼角尖尖
// A=明眸大眼（工作）/ B=眯眼（提醒）/ C=闭眼（休息）/ D=半睁（未开始）
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'eye-proto-v4');
mkdirSync(outDir, { recursive: true });

const SIZE = 44;
const CX = SIZE / 2;
const CY = SIZE / 2;

// CRC32 表必须最先初始化
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

// 右眼特征：瞳孔偏左、外眼角（右侧）尖尖
// 眼角尖 = 眼睑在左右两端收窄成点（用二次贝塞尔让两端收尖）

function drawEyeShape(rx, ry, pupilOffsetX, pupilR, lashLen, lashDroop) {
  // 上眼睑：二次贝塞尔，两端收尖（右眼角更尖）
  const upperLid = [];
  for (let t = 0; t <= 1; t += 0.01) {
    // 右眼角（t=1）更尖：用幂次让曲线在右端收得更快
    const tt = t < 0.5 ? t : 0.5 + (t - 0.5) * 1.15;
    const x = CX - rx + tt * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2);
    upperLid.push([x, y]);
  }
  // 下眼睑（同样两端收尖）
  const lowerLid = [];
  for (let t = 0; t <= 1; t += 0.01) {
    const tt = t < 0.5 ? t : 0.5 + (t - 0.5) * 1.15;
    const x = CX - rx + tt * 2 * rx;
    const y = CY + ry * Math.sqrt(1 - ((x - CX) / rx) ** 2) * 0.75; // 下眼睑更平
    lowerLid.push([x, y]);
  }
  // 睫毛：从上眼睑向外辐射，更长（8px），间距更大（22px 下能看清）
  const lashes = [];
  const lashAngles = [-1.1, -0.55, 0, 0.55, 1.1]; // 更宽间距
  for (const angle of lashAngles) {
    const t = 0.5 + angle * 0.28;
    const x = CX - rx + t * 2 * rx;
    const y = CY - ry * Math.sqrt(1 - ((x - CX) / rx) ** 2);
    // 右眼角的睫毛更翘（向外偏）
    const rad = angle * 0.5 - Math.PI / 2 + (angle > 0.4 ? 0.3 : 0) + lashDroop;
    lashes.push([[x, y], [x + Math.cos(rad) * 8, y + Math.sin(rad) * 8]]);
  }
  return { upperLid, lowerLid, lashes, pupilR, pupilY: CY, pupilOffsetX };
}

// 方案 A：明眸大眼（工作）
function drawWideOpen() {
  return drawEyeShape(19, 14, -2, 7, 8, 0); // 瞳孔偏左 2px，睫毛长 8px
}

// 方案 B：眯眼（该休息了）
function drawSquint() {
  return drawEyeShape(19, 9, -1.5, 4.5, 7, 0.4); // 更扁、睫毛长 7px 下垂
}

// 方案 C：闭眼（休息中）
function drawClosed() {
  const rx = 19;
  // 上下眼睑合并成一道弧线（两端收尖）
  const closedLid = [];
  for (let t = 0; t <= 1; t += 0.01) {
    const tt = t < 0.5 ? t : 0.5 + (t - 0.5) * 1.15;
    const x = CX - rx + tt * 2 * rx;
    const y = CY - 2 + Math.sin(tt * Math.PI) * 3; // 轻微弧度
    closedLid.push([x, y]);
  }
  // 睫毛：从弧线向下垂，更长
  const lashes = [];
  const lashAngles = [-0.9, -0.5, -0.1, 0.3, 0.7];
  for (const angle of lashAngles) {
    const t = 0.5 + angle * 0.32;
    const x = CX - rx + t * 2 * rx;
    const y = CY - 2 + Math.sin(t * Math.PI) * 3;
    const rad = Math.PI / 2 + angle * 0.35; // 向下垂
    lashes.push([[x, y], [x + Math.cos(rad) * 7, y + Math.sin(rad) * 7]]);
  }
  return { upperLid: closedLid, lowerLid: [], lashes, pupilR: 0, pupilY: CY, pupilOffsetX: 0 };
}

// 方案 D：半睁中性（未开始）
function drawHalfOpen() {
  return drawEyeShape(19, 11, -1.8, 5.5, 6, 0.1);
}

const protos = {
  'A-明眸大眼': drawWideOpen,
  'B-眯眼': drawSquint,
  'C-闭眼': drawClosed,
  'D-半睁': drawHalfOpen,
};

for (const [name, drawFn] of Object.entries(protos)) {
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
        if (d < 2) alpha = Math.max(alpha, Math.min(1, (2 - d) / 2) * 0.9);
      }
      // 瞳孔（偏左，右眼特征）
      if (pupilR > 0) {
        const pd = Math.hypot(px - (CX + pupilOffsetX), py - pupilY);
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
