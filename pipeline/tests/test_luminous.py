import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_luminous import make_catalog


def test_distant_luminous_star_survives_and_uncertain_bright_star_is_excluded(tmp_path):
    """At 20 kpc G=14 is luminous enough. Apparent G alone cannot select it."""
    data = pd.DataFrame(dict(
        source_id=[100, 101, 102, 103], ra=[0]*4, dec=[0]*4,
        phot_g_mean_mag=[14, 6, 10, 12], phot_bp_mean_mag=[15]*4, phot_rp_mean_mag=[13]*4,
        r_med_photogeo=[20000, 100, 5000, np.nan],
        r_lo_photogeo=[18500, 99, 2000, np.nan], r_hi_photogeo=[21000, 101, 8000, np.nan],
        r_med_geo=[10000]*4, r_lo_geo=[9500]*4, r_hi_geo=[10500]*4,
    ))
    make_catalog(data,tmp_path)
    assert json.loads((tmp_path/'coverage.json').read_text())['count']==2
