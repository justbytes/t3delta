#!/usr/bin/env python3
from __future__ import annotations

import shutil
import struct
import subprocess
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROD_SRC = ROOT / "assets/new-assets/camot3delta.png"
DEV_SRC = ROOT / "assets/new-assets/devt3delta.png"
TMP_DIR = ROOT / ".tmp-iconbuild"

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Apple's squircle is more complex than a radius, but ~22% of the canvas is
# visually close and fixes square Dock/App Store silhouettes.
APPLE_ICON_CORNER_RADIUS_RATIO = 0.223


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)


def sips_resize(src: Path, out: Path, size: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["sips", "-z", str(size), str(size), str(src), "--out", str(out)])


def _read_png_rgba(path: Path) -> tuple[int, int, bytearray]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"{path} is not a PNG")

    offset = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = None
    compressed = bytearray()

    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_data = data[offset + 8 : offset + 8 + length]
        offset += 12 + length

        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(
                ">IIBBBBB", chunk_data
            )
            if bit_depth != 8 or color_type not in (2, 6) or compression != 0 or filter_method != 0 or interlace != 0:
                raise ValueError(
                    f"Unsupported PNG format for {path}: bit_depth={bit_depth}, "
                    f"color_type={color_type}, interlace={interlace}"
                )
        elif chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        elif chunk_type == b"IEND":
            break

    if width is None or height is None or color_type is None:
        raise ValueError(f"Missing PNG IHDR in {path}")

    channels = 4 if color_type == 6 else 3
    stride = width * channels
    raw = zlib.decompress(bytes(compressed))
    rows: list[bytearray] = []
    cursor = 0

    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        row = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        prev = rows[-1] if rows else bytearray(stride)
        bpp = channels

        for i in range(stride):
            left = row[i - bpp] if i >= bpp else 0
            up = prev[i]
            up_left = prev[i - bpp] if i >= bpp else 0
            if filter_type == 0:
                value = row[i]
            elif filter_type == 1:
                value = row[i] + left
            elif filter_type == 2:
                value = row[i] + up
            elif filter_type == 3:
                value = row[i] + ((left + up) // 2)
            elif filter_type == 4:
                p = left + up - up_left
                pa = abs(p - left)
                pb = abs(p - up)
                pc = abs(p - up_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else up_left
                value = row[i] + predictor
            else:
                raise ValueError(f"Unsupported PNG filter {filter_type} in {path}")
            row[i] = value & 0xFF
        rows.append(row)

    rgba = bytearray(width * height * 4)
    out = 0
    for row in rows:
        for x in range(width):
            src = x * channels
            rgba[out] = row[src]
            rgba[out + 1] = row[src + 1]
            rgba[out + 2] = row[src + 2]
            rgba[out + 3] = row[src + 3] if channels == 4 else 255
            out += 4

    return width, height, rgba


def _write_png_rgba(path: Path, width: int, height: int, rgba: bytes | bytearray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])

    def chunk(chunk_type: bytes, chunk_data: bytes) -> bytes:
        body = chunk_type + chunk_data
        return struct.pack(">I", len(chunk_data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = bytearray(PNG_SIGNATURE)
    png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    png.extend(chunk(b"IDAT", zlib.compress(bytes(raw), level=9)))
    png.extend(chunk(b"IEND", b""))
    path.write_bytes(png)


def _rounded_rect_coverage(x: int, y: int, width: int, height: int, radius: float) -> float:
    # 4x4 supersampling gives antialiased transparent corners without pulling in
    # Pillow/Imagemagick as a project dependency.
    samples = 4
    inside = 0
    for sy in range(samples):
        py = y + (sy + 0.5) / samples
        for sx in range(samples):
            px = x + (sx + 0.5) / samples
            cx = min(max(px, radius), width - radius)
            cy = min(max(py, radius), height - radius)
            if (px - cx) ** 2 + (py - cy) ** 2 <= radius**2:
                inside += 1
    return inside / (samples * samples)


def round_png_corners(path: Path) -> None:
    width, height, rgba = _read_png_rgba(path)
    if width != height:
        raise ValueError(f"Expected square icon PNG, got {width}x{height}: {path}")
    radius = max(1.0, width * APPLE_ICON_CORNER_RADIUS_RATIO)
    for y in range(height):
        for x in range(width):
            alpha_index = (y * width + x) * 4 + 3
            coverage = _rounded_rect_coverage(x, y, width, height, radius)
            rgba[alpha_index] = round(rgba[alpha_index] * coverage)
    _write_png_rgba(path, width, height, rgba)


def resize_rounded(src: Path, out: Path, size: int) -> None:
    sips_resize(src, out, size)
    round_png_corners(out)


def make_ico(src: Path, out: Path, sizes: tuple[int, ...] = (16, 24, 32, 48, 64, 128, 256)) -> None:
    tmp = TMP_DIR
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    pngs: list[tuple[int, bytes]] = []
    for size in sizes:
        png = tmp / f"icon_{size}.png"
        resize_rounded(src, png, size)
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
        resize_rounded(src, tmp / name, size)
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["iconutil", "-c", "icns", str(tmp), "-o", str(out)])
    shutil.rmtree(tmp)


def generate_set(src: Path, directory: str, prefix: str) -> None:
    target_dir = ROOT / "assets" / directory
    target_dir.mkdir(parents=True, exist_ok=True)
    resize_rounded(src, target_dir / f"{prefix}-macos-1024.png", 1024)
    resize_rounded(src, target_dir / f"{prefix}-universal-1024.png", 1024)
    resize_rounded(src, target_dir / f"{prefix}-ios-1024.png", 1024)
    resize_rounded(src, target_dir / f"{prefix}-web-favicon-16x16.png", 16)
    resize_rounded(src, target_dir / f"{prefix}-web-favicon-32x32.png", 32)
    resize_rounded(src, target_dir / f"{prefix}-web-apple-touch-180.png", 180)
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
        resize_rounded(PROD_SRC, ROOT / relative, size)
    make_ico(PROD_SRC, ROOT / "apps/web/public/favicon.ico")
    make_ico(PROD_SRC, ROOT / "apps/marketing/public/favicon.ico")
    make_ico(PROD_SRC, ROOT / "apps/desktop/resources/icon.ico")
    make_icns(PROD_SRC, ROOT / "apps/desktop/resources/icon.icns")

    # The legacy upstream icon files were intentionally removed from the repo;
    # this generator only writes T3 Delta-branded assets with Apple-style rounded corners.


if __name__ == "__main__":
    main()
