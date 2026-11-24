"""Build an OGLE-III LMC-field octree. Positions use observed sky directions and a common host distance."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import bz2
import io
import json
import time
from pathlib import Path
from urllib.request import urlopen

import numpy as np
import pandas as pd
from astropy.coordinates import SkyCoord
import astropy.units as u

from build_octree import build_octree

URL = "https://ftp.astrouw.edu.pl/ogle/ogle3/maps/lmc/maps/"
DISTANCE = 49590.   # pc, to the centre (Pietrzynski et al. 2019)
CENTRE = (80.89, -69.756)   # RA, Dec in deg
# The LMC is a disc tilted to the line of sight (van der Marel & Kallivayalil 2014): its north-east side is nearer.
INCLINATION, NODES_PA = 26.2, 154.5   # deg; position angle of the line of nodes, from north through east
THICKNESS_PC = 500.   # display spread along the line of sight, 1 sigma


def disc_distance(ra, dec, d0=DISTANCE):
    """Distance (pc) to the inclined disc plane along each line of sight (van der Marel & Cioni 2001, eq. 8)."""
    centre, points = SkyCoord(*CENTRE, unit="deg"), SkyCoord(ra, dec, unit="deg")
    rho, phi = centre.separation(points).rad, centre.position_angle(points).rad
    i, theta = np.radians(INCLINATION), np.radians(NODES_PA)
    return d0 * np.cos(i) / (np.cos(i) * np.cos(rho) - np.sin(i) * np.sin(rho) * np.sin(phi - theta))


def coordinates(values, hours=False):
    """Convert sexagesimal OGLE coordinates to degrees, retaining declination signs."""
    parts = values.str.split(":", expand=True).astype(float).to_numpy()
    angle = np.abs(parts[:, 0]) + parts[:, 1]/60 + parts[:, 2]/3600
    return angle * np.where(parts[:, 0] < 0, -1, 1) * (15 if hours else 1)


def load_field(name, cache):
    """Cache only complete, decompressible source files and retry transient network errors."""
    path = cache / name
    for attempt in range(4):
        try:
            if path.exists():
                raw = bz2.decompress(path.read_bytes())
            else:
                with urlopen(URL + name, timeout=90) as response:
                    blob = response.read()
                raw = bz2.decompress(blob)
                path.write_bytes(blob)
            break
        except (OSError, EOFError):
            path.unlink(missing_ok=True)
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    df = pd.read_csv(io.BytesIO(raw), sep=r"\s+", header=None, usecols=[1,2,5,6,8])
    df = df[(df[5] < 90) & (df[6] < 9) & (df[8] > 0)]
    return np.column_stack([coordinates(df[1], True),coordinates(df[2]),df[5],df[6]])


def main():
    """Select measured V and V-I sources from a reproducible spread of survey subfields."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--limit", type=int, default=6000000)
    ap.add_argument("--cache", type=Path, default=Path("data/ogle"))
    args = ap.parse_args()
    args.cache.mkdir(parents=True,exist_ok=True)
    rng = np.random.default_rng(1935)
    names = [f"lmc{field}.{chip}.map.bz2" for field in range(100,216) for chip in range(1,9)]
    # A uniform reservoir of the first N sources, updated one subfield at a time.
    # Hypergeometric sampling gives every eligible row the same inclusion probability.
    result = np.empty((args.limit, 4))
    seen = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for start in range(0, len(names), 8):
            fields = pool.map(lambda name: load_field(name, args.cache), names[start:start+8])
            for field in fields:
                old = min(seen, args.limit)
                seen += len(field)
                size = min(seen, args.limit)
                if not len(field):
                    continue
                take = (len(field) if seen <= args.limit else
                        rng.hypergeometric(len(field), seen - len(field), size))
                append = size - old
                slots = rng.choice(old, take - append, replace=False)
                rows = rng.choice(len(field), take, replace=False)
                result[slots] = field[rows[:take-append]]
                result[old:size] = field[rows[take-append:]]
    if seen < args.limit:
        raise ValueError(f"Only {seen} usable OGLE sources")
    ra, dec, vmag, vi = result.T
    distance = disc_distance(ra, dec) + rng.normal(0., THICKNESS_PC, len(ra))
    gal = SkyCoord(ra=ra*u.deg,dec=dec*u.deg).galactic.cartesian.xyz.value.T * distance[:, None]
    center = np.array(SkyCoord(ra=CENTRE[0]*u.deg,dec=CENTRE[1]*u.deg).galactic.cartesian.xyz.value)*DISTANCE
    # STN1 colour is a display proxy here. The original passbands are Johnson V and Cousins I.
    build_octree(args.out,gal-center,vmag-5*np.log10(distance/10),vi,capacity=32768)
    manifest = args.out / "hierarchy.json"
    tree=json.loads(manifest.read_text())
    tree.update(origin=center.tolist(),survey="OGLE-III LMC",subfieldsRead=len(names),eligibleSources=seen,sampling="uniform reservoir over eligible sources",distancePc=DISTANCE,geometry=f"inclined disc, i = {INCLINATION} deg, line of nodes {NODES_PA} deg, sigma {THICKNESS_PC:g} pc",photometry="V, V-I")
    manifest.write_text(json.dumps(tree))
    print(f"Wrote {size:,} OGLE-III LMC-field entries in {len(tree['nodes'])} tiles",flush=True)


if __name__=="__main__":
    main()
