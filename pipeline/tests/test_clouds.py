import numpy as np
import pandas as pd

import build_lmc
import prepare


def test_cloud_members_move_and_foreground_stays():
    lmc_l, lmc_b = prepare.CLOUDS["LMC"][:2]
    df = pd.DataFrame({
        "l": [lmc_l, lmc_l, 100.0],
        "b": [lmc_b, lmc_b, 10.0],
        "parallax": [0.01, 2.0, 0.01],          # LMC member, foreground star, distant star elsewhere
        "parallax_error": [0.02, 0.02, 0.02],
        "r_med_photogeo": [8000.0, 500.0, 9000.0],
    })
    dist, src = prepare.choose_distance(df, 5.0)
    prepare.place_cloud_members(df, dist, src, 5.0)
    assert src.tolist() == [prepare.CLOUD_SOURCE, 1, 1]
    assert abs(dist[0] - 49590) < 5 * prepare.CLOUD_DEPTH_PC
    assert dist[1] == 500.0 and dist[2] == 9000.0


def test_lmc_disc_geometry():
    ra0, dec0 = build_lmc.CENTRE
    assert np.isclose(build_lmc.disc_distance(np.array([ra0]), np.array([dec0]))[0], build_lmc.DISTANCE)
    # 4 degrees north-east of the centre is nearer than 4 degrees south-west
    ne = build_lmc.disc_distance(np.array([ra0 + 4 / np.cos(np.radians(dec0)) * 0.7]), np.array([dec0 + 4 * 0.7]))[0]
    sw = build_lmc.disc_distance(np.array([ra0 - 4 / np.cos(np.radians(dec0)) * 0.7]), np.array([dec0 - 4 * 0.7]))[0]
    assert ne < build_lmc.DISTANCE < sw
    assert 0.9 * build_lmc.DISTANCE < ne and sw < 1.1 * build_lmc.DISTANCE


def test_cloud_motion_and_distance():
    from build_clouds import CLOUDS, membership, distances
    rng=np.random.default_rng(42)
    for name,(ra,dec,_,_) in CLOUDS.items():
        n=200
        stars=pd.DataFrame(dict(ra=ra+rng.normal(0,.2,n),dec=dec+rng.normal(0,.2,n),
              parallax=.02,parallax_error=.1,phot_g_mean_mag=15.,pmra=rng.normal(1,.1,n),
              pmdec=rng.normal(0,.1,n),pmra_error=.1,pmdec_error=.1,parallax_pmra_corr=0.,parallax_pmdec_corr=0.))
        stars.loc[0,"parallax"]=2.
        stars.loc[1,"pmra"]=15.
        # Outlier is outside the calibration core, inside the selection cone.
        stars.loc[1,"dec"]=dec+CLOUDS[name][3]+.2
        keep=membership(stars,name)
        assert not keep[0] and not keep[1] and keep.sum()>180
        assert np.isclose(distances(name,ra,dec),build_lmc.disc_distance(ra,dec) if name=="lmc" else 62800)
