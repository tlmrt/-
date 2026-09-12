// ============================================================
// 生成应用图标（纯 Node，无第三方依赖）
//   输出：assets/icon.ico（多尺寸，Windows 任务栏/资源管理器/快捷方式用）
//         assets/icon.png（256）、assets/tray.png（托盘，专门简化过）
// 设计：蓝色圆角外框 + 顶部深蓝"标题栏" + 白色内页 + 两枚装订环 + 一个橙色"今天"圆点
//       小尺寸（≤32）自动省略细格线，只保留环 + 圆点，保证托盘里也认得出
// 用法：node assets/gen-icon.js
// ============================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = __dirname;
const SS = 4; // 超采样倍数（抗锯齿）

const C = {
  blueA: [79, 107, 255],   // #4F6BFF 主色
  blueB: [116, 124, 255],  // 渐变到 #747CFF
  head: [47, 66, 214],     // #2F42D6 顶部标题栏
  page: [255, 255, 255],
  grid: [222, 228, 244],
  dot: [255, 138, 60],
};

// ---------- 几何工具 ----------
// 圆角矩形的有符号距离：<0 在内部
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - r;
}

// 在像素缓冲上叠加颜色（alpha 覆盖）
function blend(buf, w, x, y, rgb, a) {
  if (a <= 0) return;
  const i = (y * w + x) * 4;
  const ia = buf[i + 3] / 255;
  const na = a + ia * (1 - a);
  if (na <= 0) return;
  for (let k = 0; k < 3; k++) {
    buf[i + k] = Math.round((rgb[k] * a + buf[i + k] * ia * (1 - a)) / na);
  }
  buf[i + 3] = Math.round(na * 255);
}

function mix(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

// ---------- 画一张 size×size 的图（超采样后降采样） ----------
function render(size) {
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4, 0);

  const inset = S * 0.055;
  const radius = S * 0.225;
  const x0 = inset;
  const y0 = inset;
  const x1 = S - inset;
  const y1 = S - inset;

  const pageInset = S * 0.155;
  const px0 = pageInset;
  const py0 = y0 + S * 0.195;       // 内页从"标题栏"下方开始
  const px1 = S - pageInset;
  const py1 = y1 - pageInset * 0.95;
  const pageR = S * 0.075;

  // 两枚装订环
  const ringW = S * 0.085;
  const ringX = [S * 0.345, S * 0.655];
  const ringTop = y0 + S * 0.055;
  const ringBot = py0 + S * 0.03;
  const ringR = ringW / 2;

  // 今天圆点（内页里的橙色点）
  const dotR = S * (size <= 32 ? 0.105 : 0.08);
  const dotCx = (px0 + px1) / 2;
  const dotCy = size <= 32 ? py0 + (py1 - py0) * 0.55 : py0 + (py1 - py0) * 0.30;

  // 细格线（只在较大尺寸画）
  const lineH = Math.max(1, S * 0.017);
  const lineY = [py0 + (py1 - py0) * 0.52, py0 + (py1 - py0) * 0.76];
  const lineX0 = px0 + (px1 - px0) * 0.18;
  const lineX1 = px1 - (px1 - px0) * 0.18;

  const aa = 1.2; // 边缘过渡宽度（超采样空间）
  const cov = (d) => Math.min(1, Math.max(0, 0.5 - d / aa));

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;

      // ① 外框（蓝色渐变）
      const dOuter = sdRoundRect(cx, cy, x0, y0, x1, y1, radius);
      const aOuter = cov(dOuter);
      if (aOuter > 0) {
        const t = Math.min(1, Math.max(0, (cy - y0) / (y1 - y0)));
        blend(buf, S, x, y, mix(C.blueA, C.blueB, t), aOuter);
      }
      if (aOuter <= 0) continue;

      // ② 顶部标题栏（外框顶部深蓝，仅内页以上区域）
      if (cy < py0 && cy > y0) {
        const t = Math.min(1, Math.max(0, (cy - y0) / (py0 - y0)));
        blend(buf, S, x, y, mix(C.head, C.blueA, t * 0.35), aOuter);
      }

      // ③ 白色内页
      const dPage = sdRoundRect(cx, cy, px0, py0, px1, py1, pageR);
      const aPage = cov(dPage);
      if (aPage > 0) blend(buf, S, x, y, C.page, aPage);

      // ④ 细格线
      if (size > 32 && aPage > 0) {
        for (const ly of lineY) {
          if (Math.abs(cy - ly) < lineH / 2 && cx > lineX0 && cx < lineX1) {
            blend(buf, S, x, y, C.grid, Math.min(1, aPage) * 0.95);
          }
        }
      }

      // ⑤ 今天圆点
      const dd = Math.hypot(cx - dotCx, cy - dotCy) - dotR;
      const aDot = cov(dd);
      if (aDot > 0) blend(buf, S, x, y, C.dot, aDot);

      // ⑥ 装订环（白色，压在最上面）
      for (const rx of ringX) {
        const dRing = sdRoundRect(cx, cy, rx - ringW / 2, ringTop, rx + ringW / 2, ringBot, ringR);
        const aRing = cov(dRing);
        if (aRing > 0) blend(buf, S, x, y, C.page, aRing * 0.98);
      }
    }
  }

  // 降采样（超采样平滑）
  const out = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          const pa = buf[i + 3] / 255;
          r += buf[i] * pa;
          g += buf[i + 1] * pa;
          b += buf[i + 2] * pa;
          a += pa;
        }
      }
      const n = SS * SS;
      const oi = (y * size + x) * 4;
      if (a > 0) {
        out[oi] = Math.round(r / a);
        out[oi + 1] = Math.round(g / a);
        out[oi + 2] = Math.round(b / a);
      }
      out[oi + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

// ---------- PNG 编码 ----------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO 容器（内嵌多尺寸 PNG） ----------
function buildIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);            // type = icon
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);       // planes
    dir.writeUInt16LE(32, o + 6);      // bpp
    dir.writeUInt32BE(0, o + 8);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([head, dir, ...entries.map((e) => e.png)]);
}

// ---------- 生成 ----------
const sizes = [16, 24, 32, 48, 64, 128, 256];
const entries = sizes.map((s) => {
  const rgba = render(s);
  return { size: s, png: encodePng(rgba, s) };
});

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(entries));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), entries.find((e) => e.size === 256).png);
// 托盘：Windows 托盘常用 16~24px，提供 32px 清晰版让系统缩放
fs.writeFileSync(path.join(OUT_DIR, 'tray.png'), entries.find((e) => e.size === 32).png);

// ---------- 自检：把关键特征量出来，避免"生成完没验证" ----------
function px(size, x, y) {
  const e = entries.find((v) => v.size === size);
  const rgba = render(size);
  const i = (y * size + x) * 4;
  return { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], a: rgba[i + 3] };
}
const checks = [];
const c256 = { top: px(256, 128, 30), page: px(256, 128, 150), corner: px(256, 3, 3) };
checks.push(['256 顶部是深蓝', c256.top.b > 150 && c256.top.r < 120]);
checks.push(['256 中部是白页', c256.page.r > 235 && c256.page.g > 235 && c256.page.b > 235]);
checks.push(['256 四角透明（圆角）', c256.corner.a < 40]);
const c32 = { ring: px(32, 11, 5), page: px(32, 16, 18), corner: px(32, 1, 1) };
checks.push(['32 顶部有白色装订环', c32.ring.a > 120 && c32.ring.r > 200]);
checks.push(['32 中部可见（非全透明）', c32.page.a > 200]);
checks.push(['32 四角透明', c32.corner.a < 60]);
const c16 = { mid: px(16, 8, 9), corner: px(16, 1, 1) };
checks.push(['16 中部有内容', c16.mid.a > 180]);
checks.push(['16 四角透明', c16.corner.a < 80]);

console.log('生成完成：');
console.log('  icon.ico  ', (fs.statSync(path.join(OUT_DIR, 'icon.ico')).size / 1024).toFixed(1), 'KB  尺寸:', sizes.join('/'));
console.log('  icon.png  ', (fs.statSync(path.join(OUT_DIR, 'icon.png')).size / 1024).toFixed(1), 'KB  256×256');
console.log('  tray.png  ', (fs.statSync(path.join(OUT_DIR, 'tray.png')).size / 1024).toFixed(1), 'KB  32×32');
// 用字符画把图标"画"出来（--ascii 参数），便于在没有图像预览的环境下核对外观
if (process.argv.includes('--ascii')) {
  const s = 40;
  const rgba = render(s);
  const rows = [];
  for (let y = 0; y < s; y++) {
    let line = '';
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
      if (a < 40) { line += ' '; continue; }
      const white = r > 210 && g > 210 && b > 210;
      const orange = r > 200 && g > 100 && g < 200 && b < 130;
      const deep = b > 150 && r < 90;
      line += orange ? 'O' : (white ? '#' : (deep ? '@' : '.'));
    }
    rows.push(line);
  }
  console.log('\n字符画（# 白页/装订环  @ 深蓝标题栏  . 蓝外框  O 今天圆点）：');
  console.log(rows.join('\n'));
}

let bad = 0;
for (const [name, okFlag] of checks) {
  console.log(`  ${okFlag ? '✔' : '✘'} ${name}`);
  if (!okFlag) bad++;
}
process.exit(bad ? 1 : 0);
