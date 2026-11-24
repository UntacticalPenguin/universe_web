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
