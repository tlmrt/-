# -*- coding: utf-8 -*-
# 生成 EveCalendar 图标（纯标准库，无第三方依赖）
# 输出：assets/icon.png (256)  assets/tray.png (32)
import struct, zlib, math, os

def png_bytes(w, h, rgba):
    def chunk(t, data):
        c = struct.pack('>I', len(data)) + t + data
        c += struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
        return c
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    raw = b''
    for y in range(h):
        raw += b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4])
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def build(size):
    px = bytearray(size * size * 4)
    m = max(2, int(size * 0.07))
    left, right = m, size - 1 - m
    top, bottom = m, size - 1 - m
    cr = 0.22 * (right - left)               # 圆角半径
    bodyH = bottom - top
    headH = bodyH * 0.26                     # 日历“头部”
    headY = top + headH
    # 颜色
    C_BODY_A = (79, 107, 255)                # #4F6BFF
    C_BODY_B = (122, 118, 255)
    C_HEAD = (47, 66, 214)                   # #2F42D6
    C_LINE = (255, 255, 255)
    C_RED = (255, 96, 110)

    # 白线几何
    lx0 = left + (right - left) * 0.16
    lx1 = right - (right - left) * 0.16
    lh = max(1, bodyH * 0.045)
    line_ys = [headY + bodyH * 0.18, headY + bodyH * 0.32]
    # 红点几何
    rcx = right - (right - left) * 0.18
    rcy = top + headH * 0.52
    rr = max(1.5, size * 0.058)

    def body_inside(x, y):
        ix = min(max(x, left + cr), right - cr)
        iy = min(max(y, top + cr), bottom - cr)
        dx, dy = x - ix, y - iy
        return dx * dx + dy * dy <= cr * cr + 1e-6

    for y in range(size):
        for x in range(size):
            if not body_inside(x, y):
                continue
            if y <= headY:
                base = C_HEAD
            else:
                t = (x + y) / (2.0 * (size - 1))
                base = lerp(C_BODY_A, C_BODY_B, t * 0.8)
            col = base
            # 白色“文字行”
            for ly in line_ys:
                if abs(y - ly) <= lh and lx0 <= x <= lx1:
                    col = C_LINE
                    break
            # 红色提醒点（最上层，放白线区域上方右侧）
            d = math.hypot(x - rcx, y - rcy)
            if d <= rr:
                col = C_RED
            i = (y * size + x) * 4
            px[i], px[i + 1], px[i + 2], px[i + 3] = col[0], col[1], col[2], 255
    return px

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)))
for name, s in (('icon.png', 256), ('tray.png', 32)):
    data = png_bytes(s, s, build(s))
    with open(os.path.join(out_dir, name), 'wb') as f:
        f.write(data)
    print('wrote', name, len(data), 'bytes')
