#!/usr/bin/env python3
"""Compose Chrome Web Store feature screenshots (1280×800) from raw UI captures."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
ICON = ROOT.parent / "icons" / "icon128.png"
OUT_READY = ROOT.parent.parent / "谷歌插件" / "store-ready"
OUT_LOCAL = ROOT
OUT_READY.mkdir(parents=True, exist_ok=True)

# Compose at 2× then downscale for sharper text / UI edges.
SCALE = 2
W, H = 1280 * SCALE, 800 * SCALE
OUT_W, OUT_H = 1280, 800

SLIDES = [
    {
        "file": "screenshot-1-1280x800.png",
        "src": "img1.png",
        "headline": "目录树：拖拽整理，一目了然",
        "sub": "上下拖排序，拖入文件夹中间可移入；悬停即可重命名或删除。",
    },
    {
        "file": "screenshot-2-1280x800.png",
        "src": "img2.png",
        "headline": "域名概况：看清收藏都落在哪",
        "sub": "按域名展开书签，支持跳至目录、移动与删除，快速定位。",
    },
    {
        "file": "screenshot-3-1280x800.png",
        "src": "img3.png",
        "headline": "整理建议：去重与合并一步到位",
        "sub": "找出重复网址、过小文件夹，一键去重或合并到上级。",
    },
    {
        "file": "screenshot-4-1280x800.png",
        "src": "img4.png",
        "headline": "即时搜索：标题、网址、路径都能找",
        "sub": "侧边栏秒搜书签，结果可跳至目录，边找边整理。",
    },
    {
        "file": "screenshot-5-1280x800.png",
        "src": "img5.png",
        "headline": "移动到文件夹：树形选择更省心",
        "sub": "带缩进的文件夹列表，把书签准确放到该去的位置。",
    },
]


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        p = Path(path)
        if not p.exists():
            continue
        try:
            index = 1 if bold and path.endswith(".ttc") else 0
            return ImageFont.truetype(str(p), size=size, index=index)
        except OSError:
            try:
                return ImageFont.truetype(str(p), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def gradient_bg() -> Image.Image:
    """Softer / lighter blue brand gradient."""
    img = Image.new("RGB", (W, H))
    px = img.load()
    # Soft blue (not too deep, not near-white)
    c0 = (125, 180, 245)  # mid sky blue
    c1 = (160, 200, 250)  # soft blue
    c2 = (190, 220, 252)  # light blue
    for y in range(H):
        ty = y / max(H - 1, 1)
        for x in range(W):
            tx = x / max(W - 1, 1)
            t = (tx * 0.45 + ty * 0.55)
            if t < 0.5:
                u = t * 2
                r = int(lerp(c0[0], c1[0], u))
                g = int(lerp(c0[1], c1[1], u))
                b = int(lerp(c0[2], c1[2], u))
            else:
                u = (t - 0.5) * 2
                r = int(lerp(c1[0], c2[0], u))
                g = int(lerp(c1[1], c2[1], u))
                b = int(lerp(c1[2], c2[2], u))
            # gentle warm highlight top-left
            dx = tx - 0.15
            dy = ty - 0.1
            warm = max(0.0, 1.0 - (dx * dx + dy * dy) * 5.0)
            r = min(255, int(r + 18 * warm))
            g = min(255, int(g + 10 * warm))
            px[x, y] = (r, g, b)

    draw = ImageDraw.Draw(img, "RGBA")
    step = 22 * SCALE
    for yy in range(18 * SCALE, H, step):
        for xx in range(18 * SCALE, W, step):
            draw.ellipse((xx, yy, xx + 2 * SCALE, yy + 2 * SCALE), fill=(255, 255, 255, 40))
    return img


def rounded_rect_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def fit_panel(shot: Image.Image, max_w: int, max_h: int) -> Image.Image:
    """Fit the full screenshot into the slot (no crop)."""
    shot = shot.convert("RGBA")
    scale = min(max_w / shot.width, max_h / shot.height)
    nw = max(1, int(round(shot.width * scale)))
    nh = max(1, int(round(shot.height * scale)))
    return shot.resize((nw, nh), Image.Resampling.LANCZOS)


def drop_shadow(base: Image.Image, panel: Image.Image, xy: tuple[int, int]) -> None:
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    s = Image.new("RGBA", panel.size, (15, 23, 42, 55))
    mask = rounded_rect_mask(panel.size, 18 * SCALE)
    shadow.paste(s, (xy[0] + 6 * SCALE, xy[1] + 14 * SCALE), mask)
    for _ in range(3):
        shadow = shadow.resize((shadow.width // 2, shadow.height // 2), Image.Resampling.BOX)
        shadow = shadow.resize(base.size, Image.Resampling.BILINEAR)
    base.alpha_composite(shadow)


def compose(slide: dict) -> Path:
    bg = gradient_bg().convert("RGBA")
    draw = ImageDraw.Draw(bg)

    font_eyebrow = load_font(15 * SCALE, bold=True)
    font_h = load_font(38 * SCALE, bold=True)
    font_sub = load_font(17 * SCALE, bold=False)

    # Darker text on light blue for readability
    text_main = (30, 64, 175, 255)  # #1e40af
    text_sub = (51, 65, 85, 240)  # slate
    text_eye = (71, 85, 105, 230)

    icon = Image.open(ICON).convert("RGBA").resize((22 * SCALE, 22 * SCALE), Image.Resampling.LANCZOS)
    eyebrow = "Yujiang Bookmarks · 鱼酱书签助手"
    eb_bbox = draw.textbbox((0, 0), eyebrow, font=font_eyebrow)
    eb_w = eb_bbox[2] - eb_bbox[0]
    eb_x = (W - (eb_w + 30 * SCALE)) // 2
    eb_y = 36 * SCALE
    bg.paste(icon, (eb_x, eb_y), icon)
    draw.text((eb_x + 30 * SCALE, eb_y + 1 * SCALE), eyebrow, font=font_eyebrow, fill=text_eye)

    headline = slide["headline"]
    hb = draw.textbbox((0, 0), headline, font=font_h)
    hx = (W - (hb[2] - hb[0])) // 2
    hy = 68 * SCALE
    draw.text((hx, hy), headline, font=font_h, fill=text_main)

    sub = slide["sub"]
    sb = draw.textbbox((0, 0), sub, font=font_sub)
    sx = (W - (sb[2] - sb[0])) // 2
    sy = 122 * SCALE
    draw.text((sx, sy), sub, font=font_sub, fill=text_sub)

    shot = Image.open(RAW / slide["src"])
    # Full UI visible; size balanced so the panel reads as a side panel
    panel_inner = fit_panel(shot, max_w=420 * SCALE, max_h=580 * SCALE)
    pad = 12 * SCALE
    device = Image.new(
        "RGBA",
        (panel_inner.width + pad * 2, panel_inner.height + pad * 2),
        (255, 255, 255, 255),
    )
    device_mask = rounded_rect_mask(device.size, 20 * SCALE)
    inner_mask = rounded_rect_mask(panel_inner.size, 12 * SCALE)
    tmp = Image.new("RGBA", panel_inner.size, (0, 0, 0, 0))
    tmp.paste(panel_inner, (0, 0), inner_mask)
    device.paste(tmp, (pad, pad), tmp)

    chrome = Image.new("RGBA", device.size, (255, 255, 255, 255))
    chrome.paste(device, (0, 0), device)
    chrome.putalpha(device_mask)

    dx = (W - chrome.width) // 2
    stage_top = 168 * SCALE
    stage_h = H - stage_top - 28 * SCALE
    dy = stage_top + max(0, (stage_h - chrome.height) // 2)
    drop_shadow(bg, chrome, (dx, dy))
    bg.alpha_composite(chrome, (dx, dy))

    # Downscale 2× → 1× with LANCZOS, then light sharpen
    final = bg.convert("RGB").resize((OUT_W, OUT_H), Image.Resampling.LANCZOS)
    final = final.filter(ImageFilter.UnsharpMask(radius=1.2, percent=120, threshold=2))
    final = ImageEnhance.Sharpness(final).enhance(1.08)

    out = OUT_READY / slide["file"]
    final.save(out, "PNG", optimize=False, compress_level=3)
    (OUT_LOCAL / slide["file"]).write_bytes(out.read_bytes())
    return out


def main() -> None:
    for slide in SLIDES:
        path = compose(slide)
        im = Image.open(path)
        print(f"wrote {path.name} {im.size}")


if __name__ == "__main__":
    main()
