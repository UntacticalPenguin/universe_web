"""Build BCN1 beacon tiles from four independently cached published catalogues."""
import argparse
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits

from build_octree import build_octree
from prepare import SUN_BPRP, SUN_M, galactic_to_xyz

# BCN1 has the STN1 header and five photometry arrays, followed by one packed
# record per payload row. Unquantised heliocentric distances and errors are pc.
DETAIL = np.dtype([("kind", "u1"), ("distance", "<f4"), ("error", "<f4")])
KINDS = {"cepheid": 1, "maser": 2, "rrlyrae": 3, "apogee": 4}


def beacon_rows(lon, lat, distance, error, kind, mag=SUN_M, colour=SUN_BPRP):
    """Keep invalid rows until build time so all exclusions enter the manifest."""
    xyz = galactic_to_xyz(np.asarray(lon), np.asarray(lat), np.asarray(distance))
    result = pd.DataFrame(xyz, columns=["x", "y", "z"])
    result["distance"], result["error"], result["kind"] = np.asarray(distance), np.asarray(error), kind
    result["mag"], result["colour"] = np.asarray(mag), np.asarray(colour)
    return result


def read_cepheids(t):
    """Skowron tables1: Galactic degrees, heliocentric Dist and e_Dist in pc."""
    return beacon_rows(t.GLON, t.GLAT, t.Dist, t.e_Dist, 1)


def read_masers(t):
    """Reid table1: J2000 directions and VLBI parallax with its 1-sigma error (mas)."""
    # VizieR renders the ReadMe's sexagesimal fields as RAJ2000/DEJ2000 strings.
    gal = SkyCoord(t.RAJ2000.astype(str).tolist(), t.DEJ2000.astype(str).tolist(),
                   unit=(u.hourangle, u.deg)).galactic
    parallax = t.plx.where(t.plx > 0)
    distance = 1000 / parallax
    return beacon_rows(gal.l.deg, gal.b.deg, distance, distance*t.e_plx/parallax, 2)


def read_rrlyrae(t):
    """Gaia I/358/vrrlyr photometry, Fourier metallicity, extinction and source position."""
    t = t.rename(columns={key: value[0] for key, value in RR_COLUMNS.items()})
    gal = SkyCoord(t.ra.to_numpy()*u.deg, t.dec.to_numpy()*u.deg).galactic
    absolute = .32*t.feh + 1.11
    modulus = t.g - t.ag - absolute
    distance = 10**(1 + modulus/5)
    # Muraveva et al. 2018 Table 4: intrinsic width .17 mag. Independent
    # quadrature includes reported photometry, extinction, metallicity, fit errors.
    sigma = np.sqrt(t.e_g**2+t.e_ag**2+(.32*t.e_feh)**2+(.04*t.feh)**2+.06**2+.17**2)
    error = distance*np.log(10)/5*sigma
    error = error.where((t.e_g >= 0) & (t.e_ag >= 0) & (t.e_feh >= 0))
    return beacon_rows(gal.l.deg, gal.b.deg, distance, error, 3, absolute, (t.bp-t.rp).fillna(SUN_BPRP))


def read_apogee(t):
    """DR17 astroNN HDU 1: use the spectral distance, in pc, before Gaia weighting."""
    dec = t.DEC.where(t.DEC.between(-90, 90))
    ra = t.RA.where(t.RA.between(0, 360))
    gal = SkyCoord(ra.to_numpy()*u.deg, dec.to_numpy()*u.deg).galactic
    # Operational giant selection; exclude the pipeline's -9999 missing sentinel.
    distance = t.DIST.where(t.LOGG.between(-1, 3.5))
    return beacon_rows(gal.l.deg, gal.b.deg, distance, t.DIST_ERROR, 4)


READERS = dict(cepheid=read_cepheids, maser=read_masers, rrlyrae=read_rrlyrae, apogee=read_apogee)

# From the CDS ReadMe for I/358/vrrlyr.dat. The distribution already
# includes Gaia source positions in its last two fields, so no TAP join is needed.
RR_COLUMNS = {
    "Source": ("source_id", 1, 19), "Gmagavg": ("g", 240, 249),
    "e_Gmagavg": ("e_g", 251, 263), "BPmagavg": ("bp", 265, 275),
    "RPmagavg": ("rp", 292, 302), "[M/H]": ("feh", 473, 485),
    "e_[M/H]": ("e_feh", 487, 497), "AG": ("ag", 807, 820),
    "e_AG": ("e_ag", 822, 836), "RAdeg": ("ra", 838, 859),
    "DEdeg": ("dec", 861, 882),
}


def rr_table():
    """Read the complete CDS distribution, falling back to its VizieR table service."""
    from urllib.request import urlretrieve
    from astroquery.vizier import Vizier
    with TemporaryDirectory() as tmp:
        path = Path(tmp)/"vrrlyr.dat.gz"
        try:
            urlretrieve("https://vizier.cfa.harvard.edu/ftp/cats/I/358/vrrlyr.dat.gz", path)
            frame = pd.read_fwf(path, names=list(RR_COLUMNS),
                                colspecs=[(lo-1,hi) for _,lo,hi in RR_COLUMNS.values()])
        except (OSError, EOFError) as error:
            print(f"Retrying RR Lyrae via VizieR: {error}", flush=True)
            client = Vizier(columns=list(RR_COLUMNS), row_limit=-1, timeout=300,
                            vizier_server="vizier.cfa.harvard.edu")
            frame = client.get_catalogs("I/358/vrrlyr")[0].to_pandas()
    if len(frame) != 271779 or frame.Source.isna().any() or not frame.Source.is_unique:
        raise ValueError("Incomplete or duplicated I/358/vrrlyr rows")
    return frame.sort_values("Source", kind="stable")


def download(name):
    """Fetch the documented source layout; called only by the deploy workflow."""
    if name == "apogee":
        from urllib.request import urlretrieve
        url = "https://data.sdss.org/sas/dr17/apogee/vac/apogee-astronn/apogee_astroNN-DR17.fits"
        with TemporaryDirectory() as tmp:
            path = Path(tmp)/"astroNN.fits"
            urlretrieve(url, path)
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha1").hexdigest() != "c422b9adba840b3415af2fe6dec6500219f1b68f":
                    raise ValueError("astroNN DR17 file checksum mismatch")
            with fits.open(path, memmap=True) as hdus:
                rows = hdus[1].data
                return pd.DataFrame({k: np.array(rows[k], dtype=float) for k in
                                     ["RA", "DEC", "LOGG", "DIST", "DIST_ERROR"]})
    if name == "rrlyrae":
        return rr_table()

    from astroquery.vizier import Vizier
    table, columns, count = (
        ("J/other/Sci/365.478/tables1", ["GLON", "GLAT", "Dist", "e_Dist"], 2431)
        if name == "cepheid" else
        ("J/ApJ/885/131/table1", ["RAJ2000", "DEJ2000", "plx", "e_plx"], 199)
    )
    for server in ["vizier.cds.unistra.fr", "vizier.cfa.harvard.edu"]:
        try:
            result = Vizier(columns=["recno", *columns], row_limit=-1, vizier_server=server).get_catalogs(table)[0]
            frame = result.to_pandas().sort_values("recno")
            if len(frame) != count or not frame.recno.is_unique:
                raise ValueError("incomplete catalogue")
            return frame
        except Exception as error:
            if server == "vizier.cfa.harvard.edu":
                raise
            print(f"Retrying {table} from mirror: {error}", flush=True)


def build(cache, out, capacity=32768):
    """Build one disjoint octree and record selection counts separately for each kind."""
    kept, counts = [], {}
    for name, kind in KINDS.items():
        path = cache/(name+".parquet")
        if not path.exists():
            counts[name] = dict(kind=kind, status="unavailable", input=None, kept=0, dropped=None)
            continue
        rows = pd.read_parquet(path)
        if not rows.kind.eq(kind).all():
            raise ValueError(f"unexpected kind in {path}")
        valid = np.isfinite(rows).all(axis=1) & (rows.distance > 0) & (rows.error >= 0)
        valid &= rows.error <= .30*rows.distance
        kept.append(rows.loc[valid])
        counts[name] = dict(kind=kind, status="available", input=len(rows), kept=int(valid.sum()),
                            dropped=int((~valid).sum()))
    if not any(len(part) for part in kept):
        raise ValueError("No usable beacon sources")
    rows = pd.concat(kept, ignore_index=True)
    details = np.empty(len(rows), dtype=DETAIL)
    for field in DETAIL.names:
        details[field] = rows[field]
    build_octree(out, rows[["x","y","z"]].to_numpy(), rows.mag.to_numpy(), rows.colour.to_numpy(),
                 capacity=capacity, details=details, detail_format="BCN1")
    manifest = out/"hierarchy.json"
    meta = json.loads(manifest.read_text())
    meta.update(survey="beacons", catalogues=counts, maxRelativeDistanceError=.30,
                detailFields=["kind:u8", "distancePc:f32le", "distanceErrorPc:f32le"],
                photometry="RR Lyrae uses calibrated absolute G; other kinds use solar marker stand-ins.")
    manifest.write_text(json.dumps(meta, allow_nan=False))
    print(json.dumps(counts), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--fetch", choices=KINDS)
    mode.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.fetch:
        args.cache.mkdir(parents=True, exist_ok=True)
        path = args.cache/(args.fetch+".parquet")
        frame = READERS[args.fetch](download(args.fetch))
        temp = path.with_suffix(".tmp")
        frame.to_parquet(temp, index=False)
        temp.replace(path)
    else:
        build(args.cache, args.out)
