#!/usr/bin/env python3
"""Generate Chartroom polygons from Fluffy's Terra Incognita island maps."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import stat
import zipfile
from collections import defaultdict
from io import BytesIO
from pathlib import Path, PurePosixPath

from PIL import Image


IMAGE_SIZE = 256
ALPHA_THRESHOLD = 128
SIMPLIFY_TOLERANCE_PX = 0.75
METRES_PER_DEGREE = 9000
PROVIDER = "Terra Incognita"
EXPECTED_COUNT = 42


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Fluffy's IslandOutlines.zip")
    parser.add_argument("twin_13", type=Path, help="the replacement twin_13 WebP")
    parser.add_argument("output", type=Path, help="generated .mjs path")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def validate_archive(archive: zipfile.ZipFile) -> list[dict]:
    seen: set[str] = set()
    for entry in archive.infolist():
        name = entry.filename.replace("\\", "/")
        path = PurePosixPath(name)
        if name.startswith("/") or ".." in path.parts or ":" in name:
            raise ValueError(f"Unsafe archive path: {entry.filename!r}")
        if name.casefold() in seen:
            raise ValueError(f"Duplicate archive path: {entry.filename!r}")
        seen.add(name.casefold())
        if entry.flag_bits & 1:
            raise ValueError(f"Encrypted archive entry: {entry.filename!r}")
        if stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError(f"Archive link entry: {entry.filename!r}")

    if archive.testzip() is not None:
        raise ValueError("The archive failed its CRC check.")
    try:
        metadata = json.loads(archive.read("IslandOutlines/outlines.json"))
    except KeyError as error:
        raise ValueError("The archive has no IslandOutlines/outlines.json.") from error
    if not isinstance(metadata, list) or len(metadata) != EXPECTED_COUNT:
        raise ValueError(f"Expected {EXPECTED_COUNT} metadata records.")
    return metadata


def load_rgba(source: bytes | Path, expected_format: str) -> Image.Image:
    image = Image.open(BytesIO(source) if isinstance(source, bytes) else source)
    if image.format != expected_format or image.size != (IMAGE_SIZE, IMAGE_SIZE):
        raise ValueError(f"Expected a {IMAGE_SIZE}x{IMAGE_SIZE} {expected_format} image.")
    image.load()
    return image.convert("RGBA")


def alpha_mask(image: Image.Image) -> list[list[bool]]:
    alpha = image.getchannel("A")
    return [[alpha.getpixel((x, y)) >= ALPHA_THRESHOLD for x in range(IMAGE_SIZE)] for y in range(IMAGE_SIZE)]


def trace_rings(mask: list[list[bool]]) -> list[list[tuple[int, int]]]:
    edges: set[tuple[int, int, int, int]] = set()
    for y, row in enumerate(mask):
        for x, filled in enumerate(row):
            if not filled:
                continue
            if y == 0 or not mask[y - 1][x]:
                edges.add((x, y, x + 1, y))
            if x == IMAGE_SIZE - 1 or not mask[y][x + 1]:
                edges.add((x + 1, y, x + 1, y + 1))
            if y == IMAGE_SIZE - 1 or not mask[y + 1][x]:
                edges.add((x + 1, y + 1, x, y + 1))
            if x == 0 or not mask[y][x - 1]:
                edges.add((x, y + 1, x, y))

    outgoing: dict[tuple[int, int], list[tuple[int, int, int, int]]] = defaultdict(list)
    for edge in edges:
        outgoing[edge[:2]].append(edge)
    unused = set(edges)
    rings = []
    directions = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    turn_priority = {1: 0, 0: 1, 3: 2, 2: 3}  # right, straight, left, back

    while unused:
        edge = min(unused)
        start = edge[:2]
        ring = [start]
        while True:
            unused.remove(edge)
            end = edge[2:]
            if end == start:
                break
            ring.append(end)
            candidates = [candidate for candidate in outgoing[end] if candidate in unused]
            if not candidates:
                raise ValueError("An island mask has an open boundary.")
            previous = directions[(edge[2] - edge[0], edge[3] - edge[1])]

            def rank(candidate: tuple[int, int, int, int]) -> tuple[int, tuple[int, int, int, int]]:
                current = directions[(candidate[2] - candidate[0], candidate[3] - candidate[1])]
                return turn_priority[(current - previous) % 4], candidate

            edge = min(candidates, key=rank)
        rings.append(remove_collinear(ring))
    return rings


def remove_collinear(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    kept = []
    for index, point in enumerate(points):
        before = points[index - 1]
        after = points[(index + 1) % len(points)]
        if (point[0] - before[0]) * (after[1] - point[1]) == (point[1] - before[1]) * (after[0] - point[0]):
            continue
        kept.append(point)
    if len(kept) < 3:
        raise ValueError("An island component collapsed below three boundary points.")
    return kept


def point_line_distance(point: tuple[int, int], start: tuple[int, int], end: tuple[int, int]) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    return abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / math.hypot(dx, dy)


def rdp(points: list[tuple[int, int]], tolerance: float) -> list[tuple[int, int]]:
    if len(points) <= 2:
        return points
    distances = [point_line_distance(point, points[0], points[-1]) for point in points[1:-1]]
    farthest = max(range(len(distances)), key=distances.__getitem__) if distances else 0
    if not distances or distances[farthest] <= tolerance:
        return [points[0], points[-1]]
    split = farthest + 1
    return rdp(points[: split + 1], tolerance)[:-1] + rdp(points[split:], tolerance)


def simplify_closed(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    first = max(range(len(points)), key=lambda index: math.dist(points[0], points[index]))
    second = max(range(len(points)), key=lambda index: math.dist(points[first], points[index]))
    if first > second:
        first, second = second, first
    path_a = points[first : second + 1]
    path_b = points[second:] + points[: first + 1]
    simplified = rdp(path_a, SIMPLIFY_TOLERANCE_PX)[:-1] + rdp(path_b, SIMPLIFY_TOLERANCE_PX)[:-1]
    return simplified if len(simplified) >= 3 else points


def signed_area(ring: list[tuple[int, int]]) -> float:
    return sum(x * ring[(index + 1) % len(ring)][1] - ring[(index + 1) % len(ring)][0] * y
               for index, (x, y) in enumerate(ring)) / 2


def rasterize(rings: list[list[tuple[int, int]]]) -> list[list[bool]]:
    result = [[False] * IMAGE_SIZE for _ in range(IMAGE_SIZE)]
    for y in range(IMAGE_SIZE):
        scan_y = y + 0.5
        crossings = []
        for ring in rings:
            for index, (x1, y1) in enumerate(ring):
                x2, y2 = ring[(index + 1) % len(ring)]
                if (y1 > scan_y) != (y2 > scan_y):
                    crossings.append(x1 + (scan_y - y1) * (x2 - x1) / (y2 - y1))
        crossings.sort()
        for left, right in zip(crossings[::2], crossings[1::2]):
            for x in range(max(0, math.ceil(left - 0.5)), min(IMAGE_SIZE, math.ceil(right - 0.5))):
                result[y][x] = True
    return result


def mask_iou(expected: list[list[bool]], actual: list[list[bool]]) -> float:
    intersection = union = 0
    for expected_row, actual_row in zip(expected, actual):
        for expected_pixel, actual_pixel in zip(expected_row, actual_row):
            intersection += expected_pixel and actual_pixel
            union += expected_pixel or actual_pixel
    return intersection / union if union else 1


def chart_ring(ring: list[tuple[int, int]], metadata: dict) -> list[float]:
    scale = float(metadata["metresAcross"]) / METRES_PER_DEGREE
    origin_x = float(metadata["originX"])
    origin_y = float(metadata["originY"])
    values = []
    for x, y in ring:
        values.extend((round((x / IMAGE_SIZE - origin_x) * scale, 5), round((origin_y - y / IMAGE_SIZE) * scale, 5)))
    return values


def ring_bounds(rings: list[list[float]]) -> dict[str, float]:
    xs = [ring[index] for ring in rings for index in range(0, len(ring), 2)]
    ys = [ring[index] for ring in rings for index in range(1, len(ring), 2)]
    return {"minLon": min(xs), "maxLon": max(xs), "minLat": min(ys), "maxLat": max(ys)}


def entry(metadata: dict, image: Image.Image) -> tuple[dict, float]:
    prefab = metadata.get("prefab")
    filename = metadata.get("file")
    if not isinstance(prefab, str) or filename != f"{prefab}.png" or "/" in prefab or "\\" in prefab:
        raise ValueError(f"Invalid prefab metadata: {metadata!r}")
    for key in ("metresAcross", "originX", "originY"):
        if not isinstance(metadata.get(key), (int, float)) or not math.isfinite(metadata[key]):
            raise ValueError(f"Invalid {key} for {prefab}.")
    if metadata["metresAcross"] <= 0 or not 0 <= metadata["originX"] <= 1 or not 0 <= metadata["originY"] <= 1:
        raise ValueError(f"Out-of-range placement metadata for {prefab}.")

    mask = alpha_mask(image)
    pixel_rings = [simplify_closed(ring) for ring in trace_rings(mask)]
    pixel_rings.sort(key=lambda ring: (-abs(signed_area(ring)), ring))
    fidelity = mask_iou(mask, rasterize(pixel_rings))
    if fidelity < 0.97:
        raise ValueError(f"{prefab} outline fidelity is only {fidelity:.3%}.")
    rings = [chart_ring(ring, metadata) for ring in pixel_rings]
    name = " ".join(part.capitalize() for part in prefab.split("_"))
    return {
        "id": f"terra-incognita/{prefab}",
        "name": name,
        "region": PROVIDER,
        "provider": PROVIDER,
        "port": False,
        "secret": False,
        "bounds": ring_bounds(rings),
        "shapes": [{"kind": 0, "rings": rings}],
    }, fidelity


def generate(archive_path: Path, twin_path: Path) -> tuple[list[dict], float]:
    with zipfile.ZipFile(archive_path) as archive:
        metadata = validate_archive(archive)
        replacement = load_rgba(twin_path, "WEBP")
        entries = []
        fidelities = []
        prefabs = set()
        for record in metadata:
            prefab = record.get("prefab")
            if prefab in prefabs:
                raise ValueError(f"Duplicate prefab: {prefab!r}")
            prefabs.add(prefab)
            image = replacement if prefab == "twin_13" else load_rgba(archive.read(f"IslandOutlines/{record['file']}"), "PNG")
            generated, fidelity = entry(record, image)
            entries.append(generated)
            fidelities.append(fidelity)
    return entries, min(fidelities)


def main() -> None:
    args = parse_args()
    entries, minimum_fidelity = generate(args.archive, args.twin_13)
    header = f"""// Generated Terra Incognita island-outline data. Do not edit by hand.
// Source maps and placement metadata provided directly by Fluffy for use in Sailwind Chartroom.
// IslandOutlines.zip SHA-256: {sha256(args.archive)}.
// twin_13 replacement SHA-256: {sha256(args.twin_13)}; used instead of the defective archived image.
// See THIRD-PARTY-NOTICES.md for attribution and license details.
"""
    output = f"{header}\nexport const TERRA_INCOGNITA_ISLANDS = Object.freeze({json.dumps(entries, ensure_ascii=False, separators=(',', ':'))});\n"
    args.output.write_text(output, encoding="utf-8", newline="\n")
    print(f"Wrote {len(entries)} islands to {args.output.resolve()} (minimum mask IoU {minimum_fidelity:.3%})")


if __name__ == "__main__":
    main()
