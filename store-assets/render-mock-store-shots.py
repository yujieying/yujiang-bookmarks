#!/usr/bin/env python3
"""
Capture MOCK demo panels (static HTML) and compose Chrome Web Store slides.

SAFE: never opens a Chrome profile with bookmarks, never calls chrome.bookmarks.
Only screenshots local HTML files under store-assets/mock/.
"""

from __future__ import annotations

import subprocess
import tempfile
import urllib.parse
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent
MOCK = ROOT / "mock" / "demo-panel.html"
SLIDE_HTML = ROOT / "feature-slide.html"
ICON = ROOT.parent / "icons" / "icon128.png"
OUT_READY = ROOT.parent.parent / "谷歌插件" / "store-ready"
OUT_MOCK = ROOT / "mock" / "captures"
OUT_READY.mkdir(parents=True, exist_ok=True)
OUT_MOCK.mkdir(parents=True, exist_ok=True)

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

SLIDES = [
    {
        "file": "screenshot-1-1280x800.png",
        "view": "tree",
        "headline": "目录树： / 拖拽整理，一目了然",
        "sub": "上下拖排序，拖入文件夹中间可移入； / 悬停即可重命名或删除。",
        "pills": "目录|拖拽|重命名",
    },
    {
        "file": "screenshot-2-1280x800.png",
        "view": "overview",
        "headline": "域名概况： / 看清收藏都落在哪",
        "sub": "按域名展开书签，支持跳至目录、移动与删除， / 快速定位。",
        "pills": "概况|跳至目录|域名",
    },
    {
        "file": "screenshot-3-1280x800.png",
        "view": "insights",
        "headline": "整理建议： / 去重与合并一步到位",
        "sub": "找出重复网址、过小文件夹， / 一键去重或合并到上级。",
        "pills": "去重|合并|整理",
    },
    {
        "file": "screenshot-4-1280x800.png",
        "view": "search",
        "q": "docs",
        "headline": "即时搜索： / 标题、网址、路径都能找",
        "sub": "侧边栏秒搜书签，结果可跳至目录， / 边找边整理。",
        "pills": "搜索|跳至目录",
    },
    {
        "file": "screenshot-5-1280x800.png",
        "view": "move",
        "headline": "移动到文件夹： / 树形选择更省心",
        "sub": "带缩进的文件夹列表， / 把书签准确放到该去的位置。",
        "pills": "移动|文件夹",
    },
]


def file_url(path: Path) -> str:
    return path.resolve().as_uri()


def chrome_shot(url: str, out: Path, width: int, height: int, scale: int = 2) -> None:
    """Screenshot local HTML only. No real Chrome profile / bookmarks API."""
    cmd = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--disable-extensions",
        "--disable-background-networking",
        f"--force-device-scale-factor={scale}",
        f"--window-size={width},{height}",
        f"--screenshot={out}",
        url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"Chrome shot timed out\n{url}") from e
    if not out.exists():
        raise RuntimeError(f"Chrome shot failed\n{(result.stderr or '')[-1000:]}\n{url}")


def capture_panel(slide: dict) -> Path:
    q = {"view": slide["view"]}
    if slide.get("q"):
        q["q"] = slide["q"]
    url = f"{file_url(MOCK)}?{urllib.parse.urlencode(q)}"
    raw = OUT_MOCK / f"panel-{slide['view']}.png"
    chrome_shot(url, raw, width=420, height=820, scale=2)
    # Normalize to crisp panel PNG
    im = Image.open(raw).convert("RGB")
    # Expected ~840×1640 at 2x; keep as high-res source for slide
    if im.width > 900:
        # already 2x
        pass
    im.save(raw, "PNG", optimize=False, compress_level=3)
    return raw


def compose_slide(slide: dict, panel_path: Path, out_path: Path) -> None:
    q = {
        "logo": file_url(ICON),
        "src": file_url(panel_path),
        "headline": slide["headline"],
        "sub": slide["sub"],
        "pills": slide["pills"],
    }
    url = f"{file_url(SLIDE_HTML)}?{urllib.parse.urlencode(q, quote_via=urllib.parse.quote)}"
    with tempfile.TemporaryDirectory() as tmp:
        shot = Path(tmp) / "slide.png"
        chrome_shot(url, shot, width=1280, height=800, scale=2)
        im = Image.open(shot).convert("RGB")
        if im.size != (1280, 800):
            im = im.resize((1280, 800), Image.Resampling.LANCZOS)
        im = im.filter(ImageFilter.UnsharpMask(radius=0.9, percent=85, threshold=2))
        im = ImageEnhance.Sharpness(im).enhance(1.06)
        im.save(out_path, "PNG", optimize=False, compress_level=3)


def main() -> None:
    print("SAFE MODE: mock HTML only — your real Chrome bookmarks are not touched.\n")
    for slide in SLIDES:
        print(f"[{slide['view']}] capture mock panel…")
        panel = capture_panel(slide)
        out = OUT_READY / slide["file"]
        print(f"[{slide['view']}] compose slide…")
        compose_slide(slide, panel, out)
        (ROOT / slide["file"]).write_bytes(out.read_bytes())
        print(f"  → {out.name} {Image.open(out).size}")
    print("\nDone. Outputs in store-assets/ and 谷歌插件/store-ready/")


if __name__ == "__main__":
    main()
