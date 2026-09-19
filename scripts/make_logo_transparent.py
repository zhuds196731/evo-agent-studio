# -*- coding: utf-8 -*-
"""
把「Self‑Evolving Agent 软件logo设计.png」的白底去掉、剔除右下角水印，
产出：
  public/logo.png      关于页用（含文字）透明全图
  public/icon-512.png  应用图标用（纯图形，无文字）512x512 透明
  build/icon.png       Electron 窗口图标（同上）
  build/icon.ico       Windows 打包多尺寸图标
只处理封闭白色（图形内部的白点/漩涡保留），边缘按"接近白色的程度"做半透明羽化。
"""
from __future__ import annotations

import glob
import os
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
BUILD = os.path.join(ROOT, "build")

# 源图：用户指定的「自我进化智能体软件logo设计.png」（桌面版为最新，下载目录同名文件是旧导出）
candidates = (
    glob.glob(r"C:\Users\Administrator\Desktop\*自我进化智能体软件logo*.png")
    or glob.glob(r"C:\Users\Administrator\Downloads\*自我进化智能体软件logo*.png")
    or glob.glob(r"C:\Users\Administrator\Downloads\Self*Evolving*logo*.png")
)
if not candidates:
    raise SystemExit("找不到源图 自我进化智能体软件logo设计.png")
SRC = candidates[0]
print("源图:", SRC)

im = Image.open(SRC).convert("RGBA")
arr = np.array(im)
h, w = arr.shape[:2]
rgb = arr[..., :3].astype(np.int16)
print("尺寸:", w, "x", h)

minc = rgb.min(axis=2)
maxc = rgb.max(axis=2)
# 近白（背景与字母孔洞）；阈值放宽一点，把暖白背景都吃进来
near_white = minc >= 226

# ---------- 1) 从四边洪水填充：外圈背景 ----------
bg = np.zeros((h, w), dtype=bool)
dq = deque()
for x in range(w):
    for y in (0, h - 1):
        if near_white[y, x] and not bg[y, x]:
            bg[y, x] = True
            dq.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if near_white[y, x] and not bg[y, x]:
            bg[y, x] = True
            dq.append((y, x))
while dq:
    y, x = dq.popleft()
    if y > 0 and near_white[y - 1, x] and not bg[y - 1, x]:
        bg[y - 1, x] = True; dq.append((y - 1, x))
    if y < h - 1 and near_white[y + 1, x] and not bg[y + 1, x]:
        bg[y + 1, x] = True; dq.append((y + 1, x))
    if x > 0 and near_white[y, x - 1] and not bg[y, x - 1]:
        bg[y, x - 1] = True; dq.append((y, x - 1))
    if x < w - 1 and near_white[y, x + 1] and not bg[y, x + 1]:
        bg[y, x + 1] = True; dq.append((y, x + 1))
print("外圈背景像素:", int(bg.sum()))

# ---------- 1.5) 逐层剥离：把贴着背景的抗锯齿过渡带（白→彩渐变）逐步吃进背景，
# 否则圆形和文字外圈会留一圈白色光晕 ----------
def dilate(mask: np.ndarray) -> np.ndarray:
    out = mask.copy()
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out

for th in (250, 244, 236, 226, 214, 200, 186):
    band = dilate(bg) & ~bg & (minc >= th)
    if not band.any():
        continue
    bg |= band
print("剥离过渡带后背景像素:", int(bg.sum()))

# ---------- 2) 连通域工具 ----------
def components(mask: np.ndarray):
    """返回 [(面积, ys, xs, points)]，points 便于二次改写"""
    visited = np.zeros_like(mask, dtype=bool)
    comps = []
    ys_idx, xs_idx = np.nonzero(mask)
    for sy, sx in zip(ys_idx.tolist(), xs_idx.tolist()):
        if visited[sy, sx]:
            continue
        stack = [(sy, sx)]
        visited[sy, sx] = True
        pts = []
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    stack.append((ny, nx))
        ys = [p[0] for p in pts]
        xs = [p[1] for p in pts]
        comps.append((len(pts), min(ys), max(ys), min(xs), max(xs), pts))
    return comps

nonbg = ~bg
comps = components(nonbg)
comps.sort(key=lambda c: -c[0])
area, cy0, cy1, cx0, cx1, _ = comps[0]
print(f"主体(圆形标志) bbox: x {cx0}-{cx1}, y {cy0}-{cy1}, 面积 {area}")
circle_bottom = cy1

# ---------- 3) 字母孔洞：文字区域内的封闭白块 → 透明 ----------
holes = near_white & bg.__invert__()  # 近白且未被外圈填充
hole_comps = [c for c in components(holes) if c[0] >= 8]
made_transparent = 0
alpha = np.where(bg, 0, 255).astype(np.uint8)
for _, hy0, hy1, hx0, hx1, pts in hole_comps:
    # 只处理位于文字区域（圆下方）的封闭白块
    if hy0 > circle_bottom - 8:
        for (y, x) in pts:
            alpha[y, x] = 0
        made_transparent += len(pts)
print("字母孔洞透明化像素:", made_transparent)

# ---------- 4) 水印：文字以下残留的一切 → 透明 ----------
# 文字底部 = 圆以下深色（minc<150）像素的最大 y
dark_rows = np.nonzero((minc < 150) & nonbg & (np.arange(h)[:, None] > circle_bottom))[0]
text_bottom = int(dark_rows.max()) if dark_rows.size else circle_bottom
print("文字底部 y =", text_bottom)
kill = (np.arange(h)[:, None] > text_bottom + 14) & (alpha > 0)
alpha[kill] = 0
print("水印区域清除像素:", int(kill.sum()))

# ---------- 5) 边缘羽化：紧贴透明区的像素按"白度"给半透明 ----------
band = dilate(alpha == 0) & (alpha > 0)
t = np.clip((255 - minc) * 255 // (255 - 110), 0, 255).astype(np.uint8)
alpha[band] = np.minimum(alpha[band], t[band])
print("羽化像素:", int(band.sum()))

out = np.dstack([arr[..., :3].astype(np.uint8), alpha])
full = Image.fromarray(out, "RGBA")
full.save(os.path.join(PUBLIC, "logo.png"), optimize=True)
print("已写出 public/logo.png", full.size)

# ---------- 6) 纯图形图标：裁圆形标志，正方形补边 ----------
pad = int((cx1 - cx0) * 0.04)
side = max(cx1 - cx0 + 1, cy1 - cy0 + 1) + pad * 2
mark = full.crop((cx0 - pad, cy0 - pad, cx0 - pad + side, cy0 - pad + side))
icon512 = mark.resize((512, 512), Image.LANCZOS)
icon512.save(os.path.join(PUBLIC, "icon-512.png"), optimize=True)
icon512.save(os.path.join(BUILD, "icon.png"), optimize=True)
print("已写出 public/icon-512.png 与 build/icon.png (512x512)")

icon512.resize((256, 256), Image.LANCZOS).save(
    os.path.join(BUILD, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("已写出 build/icon.ico (16-256 多尺寸)")

# ---------- 7) 预览图（深底自检用） ----------
prev = Image.new("RGBA", (1080, 540), (17, 24, 39, 255))
prev.paste(full.resize((450, 450), Image.LANCZOS), (20, 45), full.resize((450, 450), Image.LANCZOS))
prev.paste(icon512.resize((450, 450), Image.LANCZOS), (590, 45), icon512.resize((450, 450), Image.LANCZOS))
prev.convert("RGB").save(os.path.join(ROOT, "scripts", "_logo_preview.png"))
print("已写出 scripts/_logo_preview.png（深底自检）")
