"""All-sky Gaia DR3 luminous tracers with Bailer-Jones distance intervals.

Search disjoint Gaia source-ID ranges over all twelve level-zero HEALPix faces.
The apparent-magnitude bound follows from the absolute cut and maximum distance;
it cannot remove an otherwise eligible source.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import os
from pathlib import Path
from time import sleep
from urllib.parse import urlencode
from urllib.request import urlopen
import xml.etree.ElementTree as ET

import numpy as np
import pandas as pd
from astropy.coordinates import SkyCoord
import astropy.units as u

from build_deep_gaia import DETAIL_DTYPE
from build_octree import build_octree
from prepare import SUN_BPRP, choose_distance, galactic_to_xyz

ENDPOINT = "https://gea.esac.esa.int/tap-server/tap/async"
MAX_DISTANCE = 30000
MAX_MAG = -2
PAGE = 30000
COLUMNS = """g.source_id,g.ra,g.dec,g.phot_g_mean_mag,g.phot_bp_mean_mag,g.phot_rp_mean_mag,
d.r_lo_geo,d.r_med_geo,d.r_hi_geo,d.r_lo_photogeo,d.r_med_photogeo,d.r_hi_photogeo"""


def query(start, end):
    """Apply the same luminosity/precision cut to the preferred distance or its fallback."""
    def cut(method):
        med = f"d.r_med_{method}"
        return (f"({med} BETWEEN 0.001 AND {MAX_DISTANCE} AND d.r_lo_{method} > 0 "
                f"AND d.r_hi_{method} - d.r_lo_{method} <= 0.4 * {med} "
                f"AND g.phot_g_mean_mag - 5 * LOG10({med} / 10.0) <= {MAX_MAG})")
    upper = MAX_MAG + 5*np.log10(MAX_DISTANCE/10)
    return f"""SELECT TOP {PAGE} {COLUMNS} FROM gaiadr3.gaia_source AS g
    JOIN external.gaiaedr3_distance AS d ON g.source_id=d.source_id
    WHERE g.source_id >= {start} AND g.source_id < {end}
    AND g.phot_g_mean_mag <= {np.ceil(upper*1000)/1000}
    AND ({cut('photogeo')} OR (d.r_med_photogeo IS NULL AND {cut('geo')}))"""


class SplitBatch(Exception):
    """The archive row limit or execution quota requires a smaller ID range."""


def validate_batch(frame, start, end):
    """Reject incomplete and overlapping batches for either transport."""
    if len(frame)>=PAGE:
        raise SplitBatch("row cap")
    if not frame.source_id.between(start,end-1).all():
        raise ValueError("source outside requested batch")
    return frame


def request_batch(start, end, archive=None):
    """Run an anonymous UWS job and retrieve its complete CSV."""
    if archive is not None:
        job = archive.launch_job_async(query(start,end))
        try:
            frame = job.get_results().to_pandas()
            frame.columns = frame.columns.str.lower()
            return validate_batch(frame,start,end)
        finally:
            archive.remove_jobs([job.jobid])
    params = dict(REQUEST="doQuery", LANG="ADQL", FORMAT="csv", MAXREC=PAGE, PHASE="RUN", QUERY=query(start,end))
    with urlopen(ENDPOINT, urlencode(params).encode(), timeout=90) as response:
        job = response.url.rstrip("/")
    for _ in range(180):
        with urlopen(job+"/phase",timeout=60) as response:
            phase = response.read().decode().strip()
        if phase=="COMPLETED":
            break
        if phase=="ABORTED":
            raise SplitBatch(f"Archive aborted {job}")
        if phase=="ERROR":
            with urlopen(job+"/error",timeout=60) as response:
                error = "".join(ET.fromstring(response.read()).itertext())
            if any(token in error.lower() for token in ("time","duration","quota","limit","cancel")):
                raise SplitBatch(error)
            raise RuntimeError(error)
        sleep(4)
    else:
        raise RuntimeError(f"Gaia job still pending: {job}")
    with urlopen(job+"/results/result",timeout=120) as response:
        frame=pd.read_csv(BytesIO(response.read()),dtype={"source_id":"int64"})
    return validate_batch(frame,start,end)


def fetch_range(bounds, archive=None):
    """Split timed-out and capped jobs. Never publish a partial survey."""
    start,end=bounds
    for attempt in range(4):
        try:
            return request_batch(start,end,archive)
        except SplitBatch:
            if end-start < 2**44:
                raise
            middle=(start+end)//2
            return pd.concat([fetch_range((start,middle),archive),fetch_range((middle,end),archive)],ignore_index=True)
        except OSError as exc:
            if attempt==3: raise
            print(f"Retrying {start}..{end}: {exc}",flush=True)
            sleep(5*(attempt+1))


def make_catalog(frame,out):
    """Validate the cut again and write observed positions, photometry and intervals."""
    if frame.empty or not frame.source_id.is_unique:
        raise ValueError("missing or duplicate Gaia results")
    med,method=choose_distance(frame,5)
    lo=np.where(method==1,frame.r_lo_photogeo,frame.r_lo_geo)
    hi=np.where(method==1,frame.r_hi_photogeo,frame.r_hi_geo)
    mag=frame.phot_g_mean_mag.to_numpy()-5*np.log10(med/10)
    keep=(lo>0)&(lo<=med)&(med<=hi)&(med<=MAX_DISTANCE)&(hi-lo<=.4*med)&(mag<=MAX_MAG)
    frame=frame.loc[keep]
    med,lo,hi,mag=med[keep],lo[keep],hi[keep],mag[keep]
    gal=SkyCoord(frame.ra.to_numpy()*u.deg,frame.dec.to_numpy()*u.deg).galactic
    xyz=galactic_to_xyz(gal.l.degree,gal.b.degree,med)
    details=np.empty(len(frame),dtype=DETAIL_DTYPE)
    details["id"],details["lo"],details["median"],details["hi"]=frame.source_id,lo,med,hi
    colour=(frame.phot_bp_mean_mag-frame.phot_rp_mean_mag).fillna(SUN_BPRP)
    build_octree(out,xyz,mag,colour.to_numpy(),capacity=4096,details=details)
    summary=dict(count=len(frame),within1kpcSun=int((med<1000).sum()),
                 within1kpcCentre=int((np.linalg.norm(xyz-[8200,0,0],axis=1)<1000).sum()),
                 farSide=int((xyz[:,0]>8200).sum()),maxDistancePc=MAX_DISTANCE,
                 maxAbsoluteG=MAX_MAG,maxRelativeIntervalHalfWidth=.20,
                 sourceIdRange=[0,str(12*2**59)],survey="Gaia DR3 × Bailer-Jones")
    (out/"coverage.json").write_text(json.dumps(summary,indent=2))
    print(summary,flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args()
    width=2**57
    ranges=[(i*width,(i+1)*width) for i in range(48)]
    archive = None
    if os.getenv("GAIA_USER") and os.getenv("GAIA_PASSWORD"):
        from astroquery.gaia import Gaia
        Gaia.login(user=os.environ["GAIA_USER"],password=os.environ["GAIA_PASSWORD"])
        archive = Gaia
    with ThreadPoolExecutor(max_workers=1 if archive else 2) as pool:
        frames=[]
        for index,frame in enumerate(pool.map(lambda bounds: fetch_range(bounds,archive),ranges)):
            frames.append(frame)
            print(f"Gaia sky batch {index+1}/48: {len(frame)} sources",flush=True)
    make_catalog(pd.concat(frames,ignore_index=True),args.out)
