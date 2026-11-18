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
    5. if the input has Gaia's GSP-Phot columns (teff_gspphot, ag_gspphot, ebpminrp_gspphot),
       also store temperature and dust per star and write version 2

File layout of stars.bin (little-endian), version 1:
    bytes 0-3    magic "STR1"
    bytes 4-7    uint32 version (1)
    bytes 8-11   uint32 N (number of stars)
    bytes 12-15  uint32 reserved (0)
    then         N x 3 float32  x, y, z in parsecs
    then         N x uint8      absolute magnitude, byte = (M - M_MIN) / (M_MAX - M_MIN) * 255
    then         N x uint8      colour, byte = (bp_rp - C_MIN) / (C_MAX - C_MIN) * 255

Version 2 (same magic, version field 2) appends three more byte arrays after the colour:
    then         N x uint8      temperature teff_gspphot, byte = (log10 T - 3.3) / 1.4 * 254   (1,995 K to 50,119 K)
    then         N x uint8      dust extinction ag_gspphot in G, byte = A_G / 8 * 254               (0 to 8 mag)
    then         N x uint8      dust reddening ebpminrp_gspphot, byte = E(BP-RP) / 4 * 254          (0 to 4 mag)
    In all three, 255 means "no value": GSP-Phot did not fit that star.
A version 2 file is 16 + 17 N bytes; version 1 is 16 + 14 N bytes.

What the new values allow: colour from Gaia's own temperature fit (better than bp_rp for giants and
reddened stars), and a "no dust" view: intrinsic colour bp_rp - E(BP-RP) and brightness M - A_G.
Both GSP-Phot values are line-of-sight estimates from Earth with known biases (see the Gaia DR3
documentation, section on astrophysical parameters); treat them as approximate.

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
VERSION_WITH_ASTROPHYSICS = 2
TEFF_LOG_RANGE = (3.3, 4.7)    # log10 kelvin stored: 1,995 K to 50,119 K
AG_RANGE = (0.0, 8.0)          # A_G (mag) stored
EBR_RANGE = (0.0, 4.0)         # E(BP-RP) (mag) stored
MISSING = 255                  # byte value for "no GSP-Phot value"
SUN_TEFF = 5772.0
GSPPHOT_COLUMNS = ("teff_gspphot", "ag_gspphot", "ebpminrp_gspphot")


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


def quantise_optional(values: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Like quantise, but onto 0-254 and with NaN stored as MISSING (255)."""
    out = np.full(len(values), MISSING, dtype=np.uint8)
    ok = np.isfinite(values)
    out[ok] = np.round(np.clip((values[ok] - lo) / (hi - lo), 0.0, 1.0) * 254).astype(np.uint8)
    return out


def write_bin(path: Path, xyz: np.ndarray, absmag: np.ndarray, colour: np.ndarray,
              astrophysics: dict[str, np.ndarray] | None = None) -> None:
    """Write version 1, or version 2 when `astrophysics` holds teff (K), ag and ebpminrp (mag), NaN where unknown."""
    n = len(xyz)
    path.parent.mkdir(parents=True, exist_ok=True)
    version = VERSION if astrophysics is None else VERSION_WITH_ASTROPHYSICS
    with open(path, "wb") as f:
        f.write(MAGIC + struct.pack("<III", version, n, 0))
        f.write(xyz.astype("<f4").tobytes())
        f.write(quantise(absmag, M_MIN, M_MAX).tobytes())
        f.write(quantise(colour, C_MIN, C_MAX).tobytes())
        if astrophysics is not None:
            teff = astrophysics["teff"]
            log_teff = np.where(teff > 0, np.log10(np.where(teff > 0, teff, 1.0)), np.nan)
            f.write(quantise_optional(log_teff, *TEFF_LOG_RANGE).tobytes())
            f.write(quantise_optional(astrophysics["ag"], *AG_RANGE).tobytes())
            f.write(quantise_optional(astrophysics["ebpminrp"], *EBR_RANGE).tobytes())


def astrophysics_of(df: pd.DataFrame) -> dict[str, np.ndarray] | None:
    """GSP-Phot temperature and dust per row (NaN where missing), or None when the input lacks the columns."""
    if not all(c in df.columns for c in GSPPHOT_COLUMNS):
        return None
    return {
        "teff": df["teff_gspphot"].to_numpy(float),
        "ag": df["ag_gspphot"].to_numpy(float),
        "ebpminrp": df["ebpminrp_gspphot"].to_numpy(float),
    }


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

    astrophysics = astrophysics_of(df)

    # The Sun itself, at the origin.
    xyz = np.vstack([[0.0, 0.0, 0.0], xyz])
    absmag = np.concatenate([[SUN_M], absmag])
    colour = np.concatenate([[SUN_BPRP], colour])
    if astrophysics is not None:
        sun = {"teff": SUN_TEFF, "ag": 0.0, "ebpminrp": 0.0}
        astrophysics = {k: np.concatenate([[sun[k]], v]) for k, v in astrophysics.items()}

    write_bin(args.out, xyz, absmag, colour, astrophysics)

    meta = {
        "version": VERSION if astrophysics is None else VERSION_WITH_ASTROPHYSICS,
        "count": int(len(xyz)),
        "input_rows": int(n_in),
        "dropped_rows": int(n_in - keep.sum()),
        "distance_source": {
            "bailer_jones_photogeo": int((src == 1).sum()),
            "bailer_jones_geo": int((src == 2).sum()),
            "inverse_parallax": int((src == 3).sum()),
        },
        "gspphot_coverage": None if astrophysics is None else {
            k: int(np.isfinite(v).sum()) for k, v in astrophysics.items()
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
