"""Select Magellanic members in Gaia cone searches (Luri et al. 2021, sections 2–4)."""
import argparse
import json
import os
from pathlib import Path
import re

import numpy as np
from astropy.coordinates import SkyCoord
from build_lmc import disc_distance
from build_octree import build_octree
from prepare import SUN_BPRP

# ICRS centres and proper-motion calibration radii from Luri et al.; outer
# search radii and limiting magnitude are the G5 catalogue specification.
CLOUDS = {"lmc": (81.28, -69.78, 10, 5), "smc": (12.80, -73.15, 5, 1.5)}
COLUMNS = ("source_id,ra,dec,pmra,pmdec,pmra_error,pmdec_error,parallax,"
           "parallax_error,parallax_pmra_corr,parallax_pmdec_corr,phot_g_mean_mag,bp_rp")


def membership(frame, cloud):
    """Fit the central projected PM ellipse twice, conditioning on median parallax."""
    ra, dec, radius, calibration = CLOUDS[cloud]
    centre = SkyCoord(ra, dec, unit="deg")
    separation = centre.separation(SkyCoord(frame.ra, frame.dec, unit="deg")).deg
    a, d, d0 = np.deg2rad(frame.ra-ra), np.deg2rad(frame.dec), np.deg2rad(dec)
    eligible = ((separation <= radius) & (frame.phot_g_mean_mag < 19)
                & (frame.parallax_error > 0) & (frame.parallax < 5*frame.parallax_error))
    core = eligible & (separation < calibration)

    def ellipse(pmra, pmdec):
        mu = np.column_stack([np.cos(a)*pmra-np.sin(d)*np.sin(a)*pmdec,
                              np.sin(d0)*np.sin(a)*pmra+(np.cos(d)*np.cos(d0)+np.sin(d)*np.sin(d0)*np.cos(a))*pmdec])
        sample = mu[core & np.isfinite(mu).all(axis=1)]
        if len(sample)<3:
            raise ValueError("insufficient proper-motion calibration stars")
        delta = mu-np.median(sample,axis=0)
        precision = np.linalg.inv(np.cov(sample.T))
        return np.einsum("ni,ij,nj->n",delta,precision,delta)<9.21

    preliminary = core & ellipse(frame.pmra,frame.pmdec)
    if not preliminary.any():
        raise ValueError("empty parallax calibration")
    difference = (frame.parallax-frame.parallax[preliminary].median())/frame.parallax_error
    return eligible & ellipse(frame.pmra-difference*frame.parallax_pmra_corr*frame.pmra_error,
                              frame.pmdec-difference*frame.parallax_pmdec_corr*frame.pmdec_error)


def distances(cloud, ra, dec):
    """Return host-plane distances in pc. The SMC plane is a kinematic approximation."""
    if cloud=="lmc":
        return disc_distance(ra,dec)
    centre=SkyCoord(*CLOUDS[cloud][:2],unit="deg")
    direction=SkyCoord(ra,dec,unit="deg")
    rho,pa=centre.separation(direction).rad,centre.position_angle(direction).rad
    # Luri et al. section 3: i=78.763 deg, receding node=8.955 deg and D=62.8 kpc.
    # Section 5.1: intersect the sightline with the plane normal (a,b,1),
    # where a=tan(i) cos(Omega) and b=-tan(i) sin(Omega).
    return 62800/(np.cos(rho)+np.tan(np.deg2rad(78.763))*np.sin(rho)*np.sin(pa-np.deg2rad(8.955)))


def fetch(archive,table,cloud):
    """Require the complete cone (compare with COUNT) before making either survey public."""
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*",table):
        raise ValueError("invalid qualified Gaia source table")
    ra,dec,radius,_=CLOUDS[cloud]
    where=(f" FROM {table} WHERE phot_g_mean_mag < 19 AND parallax_error > 0"
           f" AND parallax < 5*parallax_error AND pmra IS NOT NULL AND pmdec IS NOT NULL"
           f" AND 1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra},{dec},{radius}))")
    def run(columns):
        job=archive.launch_job_async("SELECT "+columns+where)
        try:
            return job.get_results().to_pandas()
        finally:
            archive.remove_jobs([job.jobid])
    expected=int(run("COUNT(*) AS n").iloc[0,0])
    frame=run(COLUMNS)
    frame.columns=frame.columns.str.lower()
    if len(frame)!=expected or not frame.source_id.is_unique:
        raise ValueError("incomplete or duplicate Gaia cone")
    return frame


def build(frame, cloud, out, table):
    """Use Gaia BP−RP colours and a model distance on each measured sightline."""
    clean=frame.loc[membership(frame,cloud)]
    if clean.empty:
        raise ValueError("empty Cloud selection")
    d=distances(cloud,clean.ra,clean.dec)
    gal=SkyCoord(clean.ra,clean.dec,unit="deg").galactic.cartesian.xyz.value.T*d[:,None]
    center=SkyCoord(*CLOUDS[cloud][:2],unit="deg").galactic.cartesian.xyz.value*distances(cloud,*CLOUDS[cloud][:2])
    build_octree(out,gal-center,clean.phot_g_mean_mag.to_numpy()-5*np.log10(d/10),clean.bp_rp.fillna(SUN_BPRP).to_numpy())
    manifest=out/"hierarchy.json"
    meta=json.loads(manifest.read_text())
    meta.update(origin=center.tolist(),survey="Gaia "+cloud.upper(),sourceTable=table,
                geometry="host plane model",photometry="Gaia G, BP-RP",candidateCount=len(frame))
    manifest.write_text(json.dumps(meta,allow_nan=False))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table",required=True)
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    from astroquery.gaia import Gaia
    Gaia.login(user=os.environ["GAIA_USER"],password=os.environ["GAIA_PASSWORD"])
    try:
        for name in CLOUDS:
            build(fetch(Gaia,args.table,name),name,args.out/name,args.table)
    finally:
        Gaia.logout()
