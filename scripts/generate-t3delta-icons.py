#!/usr/bin/env python3
from __future__ import annotations

import shutil
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROD_SRC = ROOT / "assets/new-assets/camot3delta.png"
DEV_SRC = ROOT / "assets/new-assets/devt3delta.png"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)


def sips_resize(src: Path, out: Path, size: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["sips", "-z", str(size), str(size), str(src), "--out", str(out)])


def make_ico(src: Path, out: Path, sizes: tuple[int, ...] = (16, 24, 32, 48, 64, 128, 256)) -> None:
    tmp = ROOT / ".tmp-iconbuild"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    pngs: list[tuple[int, bytes]] = []
    for size in sizes:
        png = tmp / f"icon_{size}.png"
        sips_resize(src, png, size)
        pngs.append((size, png.read_bytes()))

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as handle:
        handle.write(struct.pack("<HHH", 0, 1, len(pngs)))
        offset = 6 + 16 * len(pngs)
        entries: list[bytes] = []
        for size, data in pngs:
            icon_size = 0 if size >= 256 else size
            entries.append(struct.pack("<BBBBHHII", icon_size, icon_size, 0, 0, 1, 32, len(data), offset))
            offset += len(data)
        for entry in entries:
            handle.write(entry)
        for _, data in pngs:
            handle.write(data)
    shutil.rmtree(tmp)


def make_icns(src: Path, out: Path) -> None:
    tmp = ROOT / ".tmp-iconset.iconset"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    mapping = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    for name, size in mapping:
        sips_resize(src, tmp / name, size)
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["iconutil", "-c", "icns", str(tmp), "-o", str(out)])
    shutil.rmtree(tmp)


def generate_set(src: Path, directory: str, prefix: str) -> None:
    target_dir = ROOT / "assets" / directory
    target_dir.mkdir(parents=True, exist_ok=True)
    sips_resize(src, target_dir / f"{prefix}-macos-1024.png", 1024)
    sips_resize(src, target_dir / f"{prefix}-universal-1024.png", 1024)
    sips_resize(src, target_dir / f"{prefix}-ios-1024.png", 1024)
    sips_resize(src, target_dir / f"{prefix}-web-favicon-16x16.png", 16)
    sips_resize(src, target_dir / f"{prefix}-web-favicon-32x32.png", 32)
    sips_resize(src, target_dir / f"{prefix}-web-apple-touch-180.png", 180)
    make_ico(src, target_dir / f"{prefix}-web-favicon.ico")
    make_ico(src, target_dir / f"{prefix}-windows.ico")


def main() -> None:
    if not PROD_SRC.exists() or not DEV_SRC.exists():
        raise SystemExit("Missing assets/new-assets/camot3delta.png or assets/new-assets/devt3delta.png")

    generate_set(PROD_SRC, "prod", "t3delta-camo")
    generate_set(DEV_SRC, "dev", "t3delta-dev")
    generate_set(DEV_SRC, "nightly", "t3delta-dev")

    for relative, size in [
        ("apps/web/public/favicon-16x16.png", 16),
        ("apps/marketing/public/favicon-16x16.png", 16),
        ("apps/web/public/favicon-32x32.png", 32),
        ("apps/marketing/public/favicon-32x32.png", 32),
        ("apps/web/public/apple-touch-icon.png", 180),
        ("apps/marketing/public/apple-touch-icon.png", 180),
        ("apps/marketing/public/icon.png", 1024),
        ("apps/desktop/resources/icon.png", 1024),
    ]:
        sips_resize(PROD_SRC, ROOT / relative, size)
    make_ico(PROD_SRC, ROOT / "apps/web/public/favicon.ico")
    make_ico(PROD_SRC, ROOT / "apps/marketing/public/favicon.ico")
    make_ico(PROD_SRC, ROOT / "apps/desktop/resources/icon.ico")
    make_icns(PROD_SRC, ROOT / "apps/desktop/resources/icon.icns")

    # The legacy upstream icon files were intentionally removed from the repo;
    # this generator only writes T3 Delta-branded assets.


if __name__ == "__main__":
    main()
