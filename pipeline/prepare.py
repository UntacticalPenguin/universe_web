"""
Step 2 of the pipeline: turn catalog rows into a compact binary file for the viewer.

Usage:
    python prepare.py data/raw/gaia_Gbright-10.parquet
    python prepare.py data/raw/*.parquet --out ../viewer/public/data/stars.bin
    python prepare.py old_project/gaia.csv          # CSV works too

What it does per star:
    1. pick the best available distance (Bailer-Jones photogeometric > geometric > 1/parallax)
    2. convert (l, b, distance) to heliocentric galactic x, y, z in parsecs
    3. compute absolute magnitude M = m - 5 log10(d / 10 pc)
    4. quantise M and the colour index bp_rp to one byte each

File layout of stars.bin (little-endian), version 1:
    bytes 0-3    magic "STR1"
    bytes 4-7    uint32 version (1)
    bytes 8-11   uint32 N (number of stars)
    bytes 12-15  uint32 reserved (0)
    then         N x 3 float32  x, y, z in parsecs
    then         N x uint8      absolute magnitude, byte = (M - M_MIN) / (M_MAX - M_MIN) * 255
    then         N x uint8      colour, byte = (bp_rp - C_MIN) / (C_MAX - C_MIN) * 255

float32 positions are fine for this first version (stars within a few kpc).
The octree version later switches to per-tile int16 offsets.
"""
import argparse
import json
import struct
from pathlib import Path

import numpy as np
import pandas as pd

M_MIN, M_MAX = -10.0, 20.0     # absolute magnitude range stored
C_MIN, C_MAX = -0.5, 4.5       # bp_rp range stored
SUN_M, SUN_BPRP = 4.83, 0.82
MAGIC, VERSION = b"STR1", 1


def load(paths: list[Path]) -> pd.DataFrame:
    frames = [pd.read_parquet(p) if p.suffix == ".parquet" else pd.read_csv(p) for p in paths]
    df = pd.concat(frames, ignore_index=True)
    if "source_id" in df.columns:
        df = df.drop_duplicates("source_id")
    return df


def choose_distance(df: pd.DataFrame, min_snr: float) -> tuple[np.ndarray, np.ndarray]:
    """Return distance in pc and a code saying where it came from (0 = none, 1 = BJ photogeo, 2 = BJ geo, 3 = 1/parallax)."""
    n = len(df)
    dist = np.full(n, np.nan)
    src = np.zeros(n, dtype=np.uint8)

    def fill(values: np.ndarray, code: int) -> None:
        ok = np.isnan(dist) & np.isfinite(values) & (values > 0)
        dist[ok] = values[ok]
        src[ok] = code

    if "r_med_photogeo" in df:
        fill(df["r_med_photogeo"].to_numpy(float), 1)
    if "r_med_geo" in df:
        fill(df["r_med_geo"].to_numpy(float), 2)
    if "parallax" in df:
        plx = df["parallax"].to_numpy(float)
        d_plx = np.where(plx > 0, 1000.0 / np.where(plx > 0, plx, 1.0), np.nan)
        if "parallax_error" in df:
            snr = plx / df["parallax_error"].to_numpy(float)
            d_plx[~(snr >= min_snr)] = np.nan  # unreliable parallax: drop rather than create spikes
        fill(d_plx, 3)
    return dist, src


def galactic_to_xyz(l_deg: np.ndarray, b_deg: np.ndarray, d_pc: np.ndarray) -> np.ndarray:
    """Heliocentric galactic Cartesian: x toward galactic centre, y toward l = 90 deg, z toward north galactic pole."""
    l, b = np.radians(l_deg), np.radians(b_deg)
    cb = np.cos(b)
    return np.stack([d_pc * cb * np.cos(l), d_pc * cb * np.sin(l), d_pc * np.sin(b)], axis=1)


def quantise(values: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.round(np.clip((values - lo) / (hi - lo), 0.0, 1.0) * 255).astype(np.uint8)


def write_bin(path: Path, xyz: np.ndarray, absmag: np.ndarray, colour: np.ndarray) -> None:
    n = len(xyz)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(MAGIC + struct.pack("<III", VERSION, n, 0))
        f.write(xyz.astype("<f4").tobytes())
        f.write(quantise(absmag, M_MIN, M_MAX).tobytes())
        f.write(quantise(colour, C_MIN, C_MAX).tobytes())


def main() -> None:
    ap = argparse.ArgumentParser(description="Convert Gaia rows to the viewer's binary star file.")
    ap.add_argument("inputs", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("../viewer/public/data/stars.bin"))
    ap.add_argument("--min-snr", type=float, default=5.0, help="minimum parallax/error when falling back to 1/parallax")
    ap.add_argument("--max-dist", type=float, default=20000.0, help="drop stars farther than this (pc)")
    ap.add_argument("--limit", type=int, default=0, help="keep only the N brightest stars (apparent G); 0 keeps all")
    args = ap.parse_args()

    df = load(args.inputs)
    n_in = len(df)
    dist, src = choose_distance(df, args.min_snr)
    keep = np.isfinite(dist) & (dist <= args.max_dist) & np.isfinite(df["phot_g_mean_mag"].to_numpy(float))
    df, dist, src = df[keep].reset_index(drop=True), dist[keep], src[keep]
    if args.limit and len(df) > args.limit:
        brightest = np.sort(np.argsort(df["phot_g_mean_mag"].to_numpy(float), kind="stable")[: args.limit])
        df, dist, src = df.iloc[brightest].reset_index(drop=True), dist[brightest], src[brightest]

    xyz = galactic_to_xyz(df["l"].to_numpy(float), df["b"].to_numpy(float), dist)
    absmag = df["phot_g_mean_mag"].to_numpy(float) - 5.0 * np.log10(dist / 10.0)
    colour = df["bp_rp"].to_numpy(float) if "bp_rp" in df else np.full(len(df), SUN_BPRP)
    colour = np.where(np.isfinite(colour), colour, SUN_BPRP)  # missing colour: draw as Sun-coloured

    # The Sun itself, at the origin.
    xyz = np.vstack([[0.0, 0.0, 0.0], xyz])
    absmag = np.concatenate([[SUN_M], absmag])
    colour = np.concatenate([[SUN_BPRP], colour])

    write_bin(args.out, xyz, absmag, colour)

    meta = {
        "version": VERSION,
        "count": int(len(xyz)),
        "input_rows": int(n_in),
        "dropped_rows": int(n_in - keep.sum()),
        "distance_source": {
            "bailer_jones_photogeo": int((src == 1).sum()),
            "bailer_jones_geo": int((src == 2).sum()),
            "inverse_parallax": int((src == 3).sum()),
        },
        "absmag_range": [M_MIN, M_MAX],
        "colour_range": [C_MIN, C_MAX],
        "max_distance_pc": float(np.max(np.linalg.norm(xyz, axis=1))),
        "inputs": [p.name for p in args.inputs],
        "limit": args.limit or None,
    }
    args.out.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))
    print(f"Wrote {args.out} ({args.out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
