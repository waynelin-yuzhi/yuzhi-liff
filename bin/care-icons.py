#!/usr/bin/env python3
"""照顧速查圖示（品種卡速查卡用）：米紙底、圓角粗線，習性苔綠、忌諱赤陶；240px PNG，風格同 assets/weather。
用法：python3 bin/care-icons.py  → assets/care/*.png
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

S = 4                      # 先畫 4 倍再縮，邊緣才平滑
W = 240 * S
PAPER = (255, 252, 245)
MOSS = (95, 110, 88)
TERRA = (180, 84, 60)
LW = 13 * S
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'care')


def canvas():
    im = Image.new('RGB', (W, W), PAPER)
    return im, ImageDraw.Draw(im)


def line(d, pts, c, w=LW):
    d.line(pts, fill=c, width=w, joint='curve')
    r = w / 2
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)


def ring(d, cx, cy, r, c, w=LW):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c, width=w)


def sun(d, cx, cy, r, c, rays=8, ray_in=None, ray_out=None, only_upper=False):
    ring(d, cx, cy, r, c)
    ray_in = ray_in or r + 26 * S
    ray_out = ray_out or r + 52 * S
    for i in range(rays):
        a = math.pi * 2 * i / rays - math.pi / 2
        if only_upper and math.sin(a) > 0.2:
            continue
        line(d, [(cx + ray_in * math.cos(a), cy + ray_in * math.sin(a)), (cx + ray_out * math.cos(a), cy + ray_out * math.sin(a))], c)


def outline(im, shape_fn, c, w=LW):
    """把 shape_fn 在遮罩上畫的實心形狀，描成 w 粗的外框（聯集後再描，接縫不會有疙瘩）"""
    m = Image.new('L', (W, W), 0)
    shape_fn(ImageDraw.Draw(m))
    k = int(w * 1.3) | 1
    inner = m.filter(ImageFilter.MinFilter(k))
    ring_mask = Image.eval(Image.merge('L', [m]), lambda v: v)
    ring_mask = Image.composite(Image.new('L', (W, W), 0), m, inner)
    im.paste(Image.new('RGB', (W, W), PAPER), (0, 0), m)
    im.paste(Image.new('RGB', (W, W), c), (0, 0), ring_mask)


def cloud(im, x, y, w, c):
    h = w * 0.42
    parts = [(x + w * 0.30, y + h * 0.62, w * 0.20), (x + w * 0.55, y + h * 0.42, w * 0.26), (x + w * 0.78, y + h * 0.68, w * 0.17)]
    bottom = max(cy + r for cx, cy, r in parts)
    base = [x + w * 0.10, y + h * 0.62, x + w * 0.95, bottom]

    def shp(d):
        for cx, cy, r in parts:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
        d.rounded_rectangle(base, radius=(base[3] - base[1]) / 2, fill=255)
    outline(im, shp, c)


def drop(d, cx, cy, h, c):
    # 水滴：上尖下圓
    r = h * 0.36
    top = (cx, cy - h / 2)
    by = cy + h / 2 - r
    pts = []
    for i in range(0, 181, 6):
        a = math.radians(i)
        pts.append((cx + r * math.cos(a), by + r * math.sin(a)))
    pts = [top] + [(cx + r, by)] + pts[1:] + [(cx - r, by)]
    d.polygon(pts, fill=c)
    inset = LW * 0.8
    r2 = r - inset
    pts2 = []
    for i in range(0, 181, 6):
        a = math.radians(i)
        pts2.append((cx + r2 * math.cos(a), by + r2 * math.sin(a)))
    pts2 = [(cx, cy - h / 2 + inset * 2.2)] + [(cx + r2, by)] + pts2[1:] + [(cx - r2, by)]
    d.polygon(pts2, fill=PAPER)


def thermo(im, cx, cy, h, c):
    r_bulb = 34 * S
    tw = 40 * S
    top = cy - h / 2
    bulb_cy = cy + h / 2 - r_bulb

    def shp(d):
        d.rounded_rectangle([cx - tw / 2, top, cx + tw / 2, bulb_cy], radius=tw / 2, fill=255)
        d.ellipse([cx - r_bulb, bulb_cy - r_bulb, cx + r_bulb, bulb_cy + r_bulb], fill=255)
    outline(im, shp, c)
    d = ImageDraw.Draw(im)
    rb = r_bulb - LW * 1.9
    d.ellipse([cx - rb, bulb_cy - rb, cx + rb, bulb_cy + rb], fill=c)
    line(d, [(cx, bulb_cy), (cx, top + h * 0.38)], c, int(LW * 0.9))


def snow(d, cx, cy, r, c):
    for i in range(3):
        a = math.pi * i / 3
        line(d, [(cx - r * math.cos(a), cy - r * math.sin(a)), (cx + r * math.cos(a), cy + r * math.sin(a))], c, int(LW * 0.8))


def leaf(d, cx, cy, h, c):
    # 葉形：兩段弧圍成，中間葉脈
    w = h * 0.62
    pts_l, pts_r = [], []
    for i in range(0, 41):
        t = i / 40
        y = cy - h / 2 + h * t
        x = math.sin(math.pi * t) * w / 2
        pts_r.append((cx + x, y))
        pts_l.append((cx - x, y))
    d.polygon(pts_r + pts_l[::-1], fill=c)
    inner_r, inner_l = [], []
    for i in range(0, 41):
        t = i / 40
        y = cy - h / 2 + LW * 1.6 + (h - LW * 3.2) * t
        x = max(0, math.sin(math.pi * t) * w / 2 - LW)
        inner_r.append((cx + x, y))
        inner_l.append((cx - x, y))
    d.polygon(inner_r + inner_l[::-1], fill=PAPER)
    line(d, [(cx, cy - h / 2 + LW * 2.5), (cx, cy + h / 2 + 18 * S)], c, int(LW * 0.9))


def save(im, name):
    os.makedirs(OUT, exist_ok=True)
    im.resize((240, 240), Image.LANCZOS).save(os.path.join(OUT, name + '.png'), optimize=True)


def main():
    C = W / 2
    # 光照：陽性（全日照）
    im, d = canvas(); sun(d, C, C, 62 * S, MOSS); save(im, 'light-sun')
    # 光照：半陰（明亮散射光）
    im, d = canvas(); sun(d, C - 30 * S, C - 28 * S, 46 * S, MOSS, rays=8, ray_in=68 * S, ray_out=90 * S, only_upper=True); cloud(im, C - 70 * S, C + 2 * S, 175 * S, MOSS); save(im, 'light-half')
    # 光照：陰性（耐陰）
    im, d = canvas(); cloud(im, C - 105 * S, C - 52 * S, 210 * S, MOSS); save(im, 'light-shade')
    # 水分：耐旱／中等／喜濕＝1～3 滴
    im, d = canvas(); drop(d, C, C + 4 * S, 130 * S, MOSS); save(im, 'water-1')
    im, d = canvas(); drop(d, C - 42 * S, C + 8 * S, 110 * S, MOSS); drop(d, C + 42 * S, C + 8 * S, 110 * S, MOSS); save(im, 'water-2')
    im, d = canvas(); drop(d, C, C - 40 * S, 92 * S, MOSS); drop(d, C - 52 * S, C + 44 * S, 92 * S, MOSS); drop(d, C + 52 * S, C + 44 * S, 92 * S, MOSS); save(im, 'water-3')
    # 溫度：怕冷（溫度計＋雪花）／一般
    im, d = canvas(); thermo(im, C - 28 * S, C, 170 * S, MOSS); snow(d, C + 60 * S, C - 46 * S, 30 * S, MOSS); save(im, 'temp-cold')
    im, d = canvas(); thermo(im, C, C, 170 * S, MOSS); save(im, 'temp')
    # 忌：禁止符號（赤陶）
    im, d = canvas(); ring(d, C, C, 74 * S, TERRA); line(d, [(C - 50 * S, C - 50 * S), (C + 50 * S, C + 50 * S)], TERRA); save(im, 'avoid')
    # 照顧重點：葉子
    im, d = canvas(); leaf(d, C, C - 10 * S, 160 * S, MOSS); save(im, 'tip')


if __name__ == '__main__':
    main()
