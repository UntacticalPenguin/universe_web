"""Build luminosity-sorted STN1 tiles and their subtree summaries."""
import argparse
import json
import os
import struct
import tempfile
import time
from pathlib import Path

import numpy as np
import prepare


def build_octree(out, xyz, mag, colour, astro=None, capacity=32768, details=None):
    """Partition a float64 catalog using stable absolute-magnitude order and deterministic tile shuffles."""
    if capacity < 1 or not len(xyz):
        raise ValueError("a nonempty catalog and positive capacity are required")
    rng = np.random.default_rng(42)
    missing = np.full(len(mag), np.nan)
    astro = astro or {}
    ag = astro.get("ag", missing)
    red = astro.get("ebpminrp", missing)
    teff = astro.get("teff", missing)
    measured = np.isfinite(teff) & (teff > 0)
    log_t = np.log10(np.where(measured, teff, 1.0))
    intrinsic_t = prepare.temperature_of(colour - np.where(np.isfinite(red), red, 0))
    log_t0 = np.where(measured, log_t, np.log10(intrinsic_t))
    lum = 10 ** (-0.4 * (mag - prepare.SUN_M))
    lum0 = lum * 10 ** (0.4 * np.where(np.isfinite(ag), ag, 0))
    fields = [
        prepare.quantise(mag, prepare.M_MIN, prepare.M_MAX),
        prepare.quantise(colour, prepare.C_MIN, prepare.C_MAX),
        prepare.quantise_optional(np.where(measured, log_t, np.nan), *prepare.TEFF_LOG_RANGE),
        prepare.quantise_optional(ag, *prepare.AG_RANGE),
        prepare.quantise_optional(red, *prepare.EBR_RANGE),
    ]
    nodes = {}
    extent = float(np.max(np.abs(xyz)))
    half = 2.0 ** np.ceil(np.log2(extent)) if extent else 1.0
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)

    def visit(folder, name, center, half, rows):
        """Write this node and recurse on fainter rows in each occupied octant."""
        count = len(rows) if len(name) == 22 else min(capacity, len(rows))
        stored = rng.permutation(rows[:count])
        offsets = np.rint((xyz[stored] - center) * (32767 / half)).astype("<i2")
        with (folder / (name + ".bin")).open("wb") as tile:
            tile.write(struct.pack("<4sIII", b"GDI1" if details is not None else b"STN1", 1, count, 0))
            tile.write(offsets.tobytes())
            for field in fields:
                tile.write(field[stored].tobytes())
            if details is not None:
                tile.write(details[stored].tobytes())
        weights, weights0 = lum[rows], lum0[rows]
        total, total0 = weights.sum(), weights0.sum()
        children = []
        nodes[name] = dict(center=center.tolist(), half=half, count=count, subtreeCount=len(rows),
                           mMin=float(mag[rows[0]]), lSum=total, lSum0=total0,
                           centroid=[float(np.sum(weights * xyz[rows, axis]) / total) for axis in range(3)],
                           meanBpRp=np.sum(weights * colour[rows]) / total,
                           meanLogTeff0=np.sum(weights0 * log_t0[rows]) / total0, children=children)
        rest = rows[count:]
        if len(rest):
            octants = np.zeros(len(rest), dtype=np.uint8)
            for axis in range(3):
                octants |= (xyz[rest, axis] >= center[axis]).astype(np.uint8) << axis
            for octant in range(8):
                child = rest[octants == octant]
                if len(child):
                    direction = np.array([1 if octant & (1 << axis) else -1 for axis in range(3)])
                    child_name = name + str(octant)
                    children.append(child_name)
                    visit(folder, child_name, center + direction * half / 2, half / 2, child)

    with tempfile.TemporaryDirectory(dir=out) as staging:
        folder = Path(staging)
        visit(folder, "r", np.zeros(3), half, np.argsort(mag, kind="stable"))
        manifest = dict(version=1, format="GDI1" if details is not None else "STN1", root="r", capacity=capacity, nodes=nodes,
                        absmagRange=[prepare.M_MIN, prepare.M_MAX], colourRange=[prepare.C_MIN, prepare.C_MAX],
                        teffLogRange=prepare.TEFF_LOG_RANGE, agRange=prepare.AG_RANGE, reddeningRange=prepare.EBR_RANGE)
        (folder / "hierarchy.json").write_text(json.dumps(manifest, allow_nan=False))
        for name in nodes:
            (folder / (name + ".bin")).replace(out / (name + ".bin"))
        (folder / "hierarchy.json").replace(out / "hierarchy.json")
    return nodes


def main():
    """Build tiles using the same input filters and apparent-brightness limit as prepare.py."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("../viewer/public/tiles/stars"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--capacity", type=int, default=32768)
    args = ap.parse_args()
    start = time.monotonic()
    xyz, mag, colour, astro, *_ = prepare.prepare_catalog(args.inputs, args.limit)
    nodes = build_octree(args.out, xyz, mag, colour, astro, args.capacity)
    size = (args.out / "hierarchy.json").stat().st_size + 16 * len(nodes) + 11 * len(xyz)
    report = f"STN1: {len(xyz):,} stars, {len(nodes)} nodes, max depth {max(map(len, nodes))-1}, {size:,} bytes, {time.monotonic()-start:.1f} s"
    print(report)
    if summary := os.getenv("GITHUB_STEP_SUMMARY"):
        with open(summary, "a") as stream:
            print(report, file=stream)


if __name__ == "__main__":
    main()
