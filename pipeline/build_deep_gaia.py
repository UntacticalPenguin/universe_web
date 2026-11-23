"""Build the optional, uniformly random-index sampled Gaia DR3 extension."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from pathlib import Path
from time import sleep
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import pandas as pd
from astropy.coordinates import SkyCoord
import astropy.units as u

from build_octree import build_octree
from prepare import choose_distance, galactic_to_xyz, SUN_BPRP

BLOCK = 25000
BLOCKS = 80
ENDPOINT = "https://dc.g-vo.org/tap/sync"
DETAIL_DTYPE = np.dtype([("id", "<u8"), ("lo", "<f4"), ("median", "<f4"), ("hi", "<f4")])


def fetch_block(index):
    """Each disjoint random-index interval has at most BLOCK matching sources."""
    query = f"""SELECT g.source_id,g.random_index,g.ra,g.dec,g.phot_g_mean_mag,
        g.phot_bp_mean_mag,g.phot_rp_mean_mag,d.r_med_geo,d.r_lo_geo,d.r_hi_geo,
        d.r_med_photogeo,d.r_lo_photogeo,d.r_hi_photogeo
        FROM gaia.dr3lite AS g JOIN gedr3dist.main AS d ON g.source_id=d.source_id
        WHERE g.random_index >= {index * BLOCK} AND g.random_index < {(index + 1) * BLOCK}
        AND g.phot_g_mean_mag >= 13 AND g.phot_g_mean_mag < 17"""
    url = ENDPOINT + "?" + urlencode(dict(REQUEST="doQuery", LANG="ADQL", FORMAT="csv", MAXREC=BLOCK, QUERY=query))
    for attempt in range(4):
        try:
            with urlopen(url, timeout=120) as response:
                frame = pd.read_csv(BytesIO(response.read()), dtype={"source_id": "int64"})
            if not frame.random_index.between(index * BLOCK, (index + 1) * BLOCK - 1).all():
                raise ValueError("unexpected random-index range")
            return frame
        except (OSError, ValueError, AttributeError):
            if attempt == 3:
                raise
            sleep(2 ** (attempt + 1))


def build(frame, out):
    """Retain observed positions and partition by fractional distance uncertainty."""
    if not frame.source_id.is_unique or not frame.random_index.is_unique:
        raise ValueError("duplicate Gaia source or random index")
    med, source = choose_distance(frame, 5)
    lo = np.where(source == 1, frame.r_lo_photogeo, frame.r_lo_geo)
    hi = np.where(source == 1, frame.r_hi_photogeo, frame.r_hi_geo)
    valid = (lo > 0) & (lo <= med) & (med <= hi) & np.isfinite(hi) & (med <= 20000)
    frame = frame.loc[valid]
    lo, med, hi = lo[valid], med[valid], hi[valid]
    gal = SkyCoord(frame.ra.to_numpy()*u.deg, frame.dec.to_numpy()*u.deg).galactic
    xyz = galactic_to_xyz(gal.l.degree, gal.b.degree, med)
    mag = frame.phot_g_mean_mag.to_numpy() - 5 * np.log10(med / 10)
    colour = (frame.phot_bp_mean_mag - frame.phot_rp_mean_mag).fillna(SUN_BPRP).to_numpy()
    details = np.empty(len(frame), dtype=DETAIL_DTYPE)
    details["id"], details["lo"], details["median"], details["hi"] = frame.source_id, lo, med, hi
    precise = (hi - lo) / (2 * med) <= .20
    for name, mask in [("deep", precise), ("deep-wide", ~precise)]:
        build_octree(out/name, xyz[mask], mag[mask], colour[mask], capacity=4096, details=details[mask])
    print(json.dumps(dict(total=len(frame), precise=int(precise.sum()), far=int((xyz[:,0]>8200).sum()),
                          centre=int((np.linalg.norm(xyz-[8200,0,0],axis=1)<1000).sum()))))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    with ThreadPoolExecutor(max_workers=4) as pool:
        build(pd.concat(pool.map(fetch_block, range(BLOCKS)), ignore_index=True), args.out)
