#!/usr/bin/env python3
"""Render high-end store feature slides via Chrome (2×) from HTML + raw UI shots."""

from __future__ import annotations

import json
import subprocess
import tempfile
import urllib.parse
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
ICON = ROOT.parent / "icons" / "icon128.png"
HTML = ROOT / "feature-slide.html"
OUT_READY = ROOT.parent.parent / "谷歌插件" / "store-ready"
OUT_LOCAL = ROOT
OUT_READY.mkdir(parents=True, exist_ok=True)

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

SLIDES = [
    {
        "file": "screenshot-1-1280x800.png",
        "src": "img1.png",
        "headline": "目录树：拖拽整理，一目了然",
        "sub": "上下拖排序，拖入文件夹中间可移入；悬停即可重命名或删除。",
        "pills": "目录|拖拽|重命名",
    },
    {
        "file": "screenshot-2-1280x800.png",
        "src": "img2.png",
        "headline": "域名概况：看清收藏都落在哪",
        "sub": "按域名展开书签，支持跳至目录、移动与删除，快速定位。",
        "pills": "概况|跳至目录|域名",
    },
    {
        "file": "screenshot-3-1280x800.png",
        "src": "img3.png",
        "headline": "整理建议：去重与合并一步到位",
        "sub": "找出重复网址、过小文件夹，一键去重或合并到上级。",
        "pills": "去重|合并|整理",
    },
    {
        "file": "screenshot-4-1280x800.png",
        "src": "img4.png",
        "headline": "即时搜索：标题、网址、路径都能找",
        "sub": "侧边栏秒搜书签，结果可跳至目录，边找边整理。",
        "pills": "搜索|跳至目录",
    },
    {
        "file": "screenshot-5-1280x800.png",
        "src": "img5.png",
        "headline": "移动到文件夹：树形选择更省心",
        "sub": "带缩进的文件夹列表，把书签准确放到该去的位置。",
        "pills": "移动|文件夹",
    },
]


def file_url(path: Path) -> str:
    return path.resolve().as_uri()


def render_slide(slide: dict, out_path: Path) -> None:
    q = {
        "logo": file_url(ICON),
        "src": file_url(RAW / slide["src"]),
        "headline": slide["headline"],
        "sub": slide["sub"],
        "pills": slide["pills"],
    }
    query = urllib.parse.urlencode(q, quote_via=urllib.parse.quote)
    url = f"{file_url(HTML)}?{query}"

    with tempfile.TemporaryDirectory() as tmp:
        shot = Path(tmp) / "shot.png"
        cmd = [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=2",
            "--window-size=1280,800",
            "--virtual-time-budget=3000",
            f"--screenshot={shot}",
            url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not shot.exists():
            raise RuntimeError(
                f"Chrome screenshot failed for {slide['file']}\n"
                f"stderr: {result.stderr[-800:]}\nurl: {url}"
            )

        im = Image.open(shot).convert("RGB")
        if im.size != (1280, 800):
            im = im.resize((1280, 800), Image.Resampling.LANCZOS)
        im = im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=90, threshold=2))
        im = ImageEnhance.Sharpness(im).enhance(1.05)
        im.save(out_path, "PNG", optimize=False, compress_level=3)


def main() -> None:
    for slide in SLIDES:
        out = OUT_READY / slide["file"]
        print(f"rendering {slide['file']}...")
        render_slide(slide, out)
        (OUT_LOCAL / slide["file"]).write_bytes(out.read_bytes())
        print(f"  wrote {out} {Image.open(out).size}")


if __name__ == "__main__":
    main()
