// 512×512 应用图标：深色圆角底 + 眼睛造型（与托盘图标同语言，瞳孔品牌蓝）
// 输出 build/icon.png（electron-builder 自动转 icns）
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });

const SIZE = 512;
const CX = SIZE / 2;
const CY = SIZE / 2;

// 深色圆角底（macOS 图标风格：圆角矩形，半径 ~22.5%）
const RADIUS = SIZE * 0.225;
const BG_TOP = [22, 28, 40]; // #161C28 → 底部更深
const BG_BOT = [13, 16, 24];

// 眼睛
const EYE_RX = SIZE * 0.36;
const EYE_RY = SIZE * 0.24;
const PUPIL_R = SIZE * 0.125;
const PUPIL = [91, 141, 239]; // 品牌蓝 #5B8DEF

const px = new Uint8Array(SIZE * SIZE * 4);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => Math.round(a + (b - a) * t);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const fx = x + 0.5;
    const fy = y + 0.5;
    const i = (y * SIZE + x) * 4;

    // 圆角矩形覆盖（带 2px 抗锯齿）
    const dx = Math.max(Math.abs(fx - CX) - (CX - RADIUS), 0);
    const dy = Math.max(Math.abs(fy - CY) - (CY - RADIUS), 0);
    const distCorner = Math.hypot(dx, dy);
    const covBg = clamp01(RADIUS + 1 - distCorner);
    if (covBg <= 0) continue;

    // 纵向渐变底
    const t = fy / SIZE;
    px[i] = mix(BG_TOP[0], BG_BOT[0], t);
    px[i + 1] = mix(BG_TOP[1], BG_BOT[1], t);
    px[i + 2] = mix(BG_TOP[2], BG_BOT[2], t);
    px[i + 3] = Math.round(covBg * 255);

    // 眼睛：杏仁形
    const ex = (fx - CX) / EYE_RX;
    if (Math.abs(ex) <= 1) {
      const h = EYE_RY * Math.sqrt(1 - ex * ex);
      const top = CY - h;
      const bot = CY + h;
      if (fy >= top && fy <= bot) {
        const edgeV = Math.min(fy - top, bot - fy);
        const edgeH = (1 - Math.abs(ex)) * EYE_RX;
        const edge = Math.min(edgeV, edgeH);
        if (edge < SIZE * 0.014) {
          // 深色眼睑描边
          const a = clamp01((SIZE * 0.014 - edge) / (SIZE * 0.01)) * 0.85;
          px[i] = Math.round(px[i] * (1 - a) + 8 * a);
          px[i + 1] = Math.round(px[i + 1] * (1 - a) + 10 * a);
          px[i + 2] = Math.round(px[i + 2] * (1 - a) + 14 * a);
        } else {
          // 眼白（柔和白）
          px[i] = 244; px[i + 1] = 246; px[i + 2] = 250;
        }
        // 瞳孔
        const pd = Math.hypot(fx - CX, fy - CY);
        if (pd <= PUPIL_R) {
          const g = clamp01((PUPIL_R - pd) / PUPIL_R); // 径向渐变，中心更亮
          px[i] = mix(PUPIL[0], 140, g * 0.45);
          px[i + 1] = mix(PUPIL[1], 185, g * 0.45);
          px[i + 2] = mix(PUPIL[2], 255, g * 0.45);
        } else if (pd <= PUPIL_R + SIZE * 0.008) {
          px[i] = 28; px[i + 1] = 32; px[i + 2] = 40; // 瞳孔描边
        }
        // 高光
        if (Math.hypot(fx - (CX - SIZE * 0.045), fy - (CY - SIZE * 0.045)) <= SIZE * 0.035) {
          px[i] = 255; px[i + 1] = 255; px[i + 2] = 255;
        }
      }
    }
  }
}

// PNG 编码（RGBA → filter 0 → deflate）——函数与常量声明之后再执行
function encodePng() {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(row, 1);
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

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

// 执行（放在所有声明之后，避免 TDZ）
writeFileSync(join(outDir, 'icon.png'), encodePng());
console.log('ok build/icon.png', SIZE + 'x' + SIZE);
