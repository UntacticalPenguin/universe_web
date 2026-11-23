import json
import struct
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_deep_gaia import build, DETAIL_DTYPE


def test_source_intervals_follow_shuffled_rows_and_precision_groups(tmp_path):
    """Test quality classification, the radial cut, and exact row association."""
    frame = pd.DataFrame(dict(source_id=np.arange(5, dtype=np.int64)+2**59,
        random_index=range(5), ra=[0]*5, dec=[0]*5, phot_g_mean_mag=[15]*5,
        phot_bp_mean_mag=[16]*5, phot_rp_mean_mag=[14]*5,
        r_med_photogeo=[1000,2000,np.nan,4000,21000], r_lo_photogeo=[900,1600,np.nan,2000,20000],
        r_hi_photogeo=[1100,2400,np.nan,6000,22000], r_med_geo=[3000]*5,
        r_lo_geo=[2700]*5, r_hi_geo=[3300]*5))
    build(frame,tmp_path)
    for group, indices in [('deep',[0,1,2]),('deep-wide',[3])]:
        folder=tmp_path/group
        manifest=json.loads((folder/'hierarchy.json').read_text())
        tile=(folder/'r.bin').read_bytes()
        n=len(indices)
        assert manifest['format']=='GDI1'
        assert struct.unpack_from('<4sIII',tile)==(b'GDI1',1,n,0)
        details=np.frombuffer(tile,DETAIL_DTYPE,offset=16+11*n)
        assert sorted(details['id'])==list(frame.source_id[indices])
        for record in details:
            index=int(record['id'])-2**59
            assert record['median']==1000*(index+1)
