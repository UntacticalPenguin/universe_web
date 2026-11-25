import numpy as np
from build_model import build, fractions, sample


def test_model(tmp_path):
    xyz, temp, components = sample(100000, 42)
    assert np.allclose(np.bincount(components)/len(xyz), fractions(), rtol=.05)
    assert np.array_equal(xyz,sample(100000,42)[0])
    meta=build(tmp_path,123456,100000,42)
    rows=np.concatenate([np.fromfile(p,dtype='<f4',offset=16).reshape(-1,6) for p in tmp_path.glob('*.bin')])
    distance=np.linalg.norm(rows[:,:3],axis=1)
    assert np.isclose(rows[distance<1000,3].sum(),123456,rtol=.05)
    assert np.allclose(rows[:,5],np.clip((distance-2000)/2000,0,1),atol=1e-6)
    assert sum(t['count'] for t in meta['tiles'].values()) == 100000
