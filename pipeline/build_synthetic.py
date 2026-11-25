"""Fill the Milky Way beyond the Gaia bubble with synthetic stars.

Positions come from the G3 density model (build_model.sample). Each synthetic
star copies the absolute magnitude and colour of a real luminous Gaia star near
the Sun, so the colours and brightness mix are observed ones. The number is
calibrated on Gaia: within ANCHOR_PC of the Sun, the model's star count equals
the count of real stars brighter than the magnitude cut. Inside the bubble the
synthetic stars fade out so real stars are not doubled.
"""
import argparse
from pathlib import Path

import numpy as np

from build_model import sample
from build_octree import build_octree
from prepare import prepare_catalog

ANCHOR_PC = 1000.
# G < 13 is complete for M_G < 1 out to 10**((13 - 1 + 5) / 5) pc = 2.5 kpc without dust.
BRIGHTEST_CUT = 1.0
# Synthetic stars fade in between these distances from the Sun (pc).
FADE_IN = (1000., 2500.)
# Template choices per model component (0 thin disc, 1 thick disc, 2 bar, 3 arm),
# by observed BP-RP: old populations are red giants, 20 % of arm stars young and blue.
RED_GIANT_BPRP, YOUNG_BPRP, YOUNG_ARM_SHARE = 1.0, 0.5, 0.2


def magnitude_cut(local_mag, model_fraction, max_count):
    """Brightest M_G cut whose galaxy-wide count fits max_count."""
    for cut in np.arange(BRIGHTEST_CUT, -6.0, -0.25):
        total = np.count_nonzero(local_mag < cut) / model_fraction
        if total <= max_count:
            return float(cut), int(total)
    raise ValueError("max_count too small for any magnitude cut")


def synthesise(xyz, absmag, colour, max_count, seed=7):
    """Return synthetic positions (pc), absolute G, BP-RP, the cut and the calibrated count."""
    rng = np.random.default_rng(seed)
    near = np.linalg.norm(xyz, axis=1) < ANCHOR_PC
    probe, _, _ = sample(2_000_000, seed + 1)
    model_fraction = np.mean(np.linalg.norm(probe, axis=1) < ANCHOR_PC)
    cut, count = magnitude_cut(absmag[near], model_fraction, max_count)
    template = near & (absmag < cut)
    t_mag, t_col = absmag[template], colour[template]
    pos, _, component = sample(count, seed)
    pick = rng.integers(0, len(t_mag), count)
    red = np.flatnonzero(t_col > RED_GIANT_BPRP)
    blue = np.flatnonzero(t_col < YOUNG_BPRP)
    old = component == 2
    pick[old] = red[rng.integers(0, len(red), old.sum())]
    young = (component == 3) & (rng.random(count) < YOUNG_ARM_SHARE)
    pick[young] = blue[rng.integers(0, len(blue), young.sum())]
    r = np.linalg.norm(pos, axis=1)
    keep = rng.random(count) < np.clip((r - FADE_IN[0]) / (FADE_IN[1] - FADE_IN[0]), 0, 1)
    return pos[keep], t_mag[pick][keep], t_col[pick][keep], cut, count


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("../viewer/public/tiles/synthetic"))
    ap.add_argument("--max-count", type=int, default=12_000_000)
    args = ap.parse_args()
    xyz, absmag, colour, *_ = prepare_catalog(args.inputs)
    pos, mag, col, cut, count = synthesise(xyz, absmag, colour, args.max_count)
    print(f"M_G < {cut}: {count:,} stars galaxy-wide, {len(pos):,} kept outside the Gaia bubble", flush=True)
    build_octree(args.out, pos.astype(np.float64), mag, col)


if __name__ == "__main__":
    main()
