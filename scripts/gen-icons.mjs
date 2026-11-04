// 托盘/状态图标生成：纯 Node（zlib）写 PNG，无第三方依赖。
// 生成 44×44（@2x）「眼睛」图标，运行时缩到 22 显示：
//   idle 灰 / working 绿 / reminder 黄 / rest 蓝（瞳孔颜色）
//
// 设计原则（2026-11-04 李先生反馈「美观一些」后重做）：
// - 加粗描边（2.5px），白色眼白在深/浅菜单栏都清晰
// - 眼睛更饱满（占图标高度 ~68%），缩小后依然可读
// - 瞳孔加大（占眼睛宽度 ~38%），状态色一眼可辨
// - 高光提亮，增加灵气
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'icons');
mkdirSync(outDir, { recursive: true });

const ICONS = {
  'tray-idle.png': [142, 149, 158], // 灰
  'tray-working.png': [48, 164, 108], // 绿
  'tray-reminder.png': [245, 166, 35], // 黄
  'tray-rest.png': [62, 99, 221], // 蓝
};

const SIZE = 44;
const CX = SIZE / 2;
const CY = SIZE / 2;

// 眼睛造型参数（加粗描边 + 更饱满）
const EYE_RX = 21; // 横向半径（更宽，占满 44px 宽度）
const EYE_RY = 15.5; // 纵向半径（更饱满）
const PUPIL_R = 8; // 瞳孔更大，状态色更显眼
const STROKE = 3; // 描边再加粗（22px 下依然清晰）

function rasterizeEye([pr, pg, pb]) {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dx = (px - CX) / EYE_RX;
      if (Math.abs(dx) > 1) continue;
      const h = EYE_RY * Math.sqrt(1 - dx * dx);
      const top = CY - h;
      const bot = CY + h;
      if (py < top - 2 || py > bot + 2) continue;

      const edgeV = Math.min(py - top, bot - py);
      const edgeH = (1 - Math.abs(dx)) * EYE_RX;
      const edge = Math.min(edgeV, edgeH);

      const i = 1 + x * 4;
      if (edge < STROKE) {
        // 深色描边（加粗，抗锯齿过渡）
        const a = Math.min(1, Math.max(0, (STROKE - edge) / STROKE)) * 0.92;
        row[i] = 30;
        row[i + 1] = 34;
        row[i + 2] = 42;
        row[i + 3] = Math.round(a * 255);
      } else {
        // 眼白（柔和白，非死白）
        row[i] = 252;
        row[i + 1] = 253;
        row[i + 2] = 254;
        row[i + 3] = 248;
      }

      // 瞳孔：状态色 + 深色细边 + 左上高光
      const pd = Math.hypot(px - CX, py - CY);
      if (pd <= PUPIL_R + 1.1) {
        if (pd > PUPIL_R - 0.5) {
          // 瞳孔描边（深色，1px）
          row[i] = 30; row[i + 1] = 34; row[i + 2] = 42; row[i + 3] = 220;
        } else {
          // 瞳孔主色（状态色）
          row[i] = pr; row[i + 1] = pg; row[i + 2] = pb; row[i + 3] = 255;
        }
      }
      // 高光（左上方小亮点，增加灵气）
      if (Math.hypot(px - (CX - 3), py - (CY - 3)) <= 2.2) {
        row[i] = 255; row[i + 1] = 255; row[i + 2] = 255; row[i + 3] = 240;
      }
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function writePng(file, rawRgbaWithFilterBytes) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rawRgbaWithFilterBytes, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
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

// 生成（放在所有声明之后，避免 TDZ）
for (const [name, rgb] of Object.entries(ICONS)) {
  writePng(join(outDir, name), rasterizeEye(rgb));
  console.log('ok', name);
}
