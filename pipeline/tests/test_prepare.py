"""Run with:  python -m pytest tests"""
import struct
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import astropy.units as u
from astropy.coordinates import SkyCoord

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepare  # noqa: E402


def test_galactic_to_xyz_matches_astropy():
    rng = np.random.default_rng(1)
    l = rng.uniform(0, 360, 1000)
    b = rng.uniform(-90, 90, 1000)
    d = 10 ** rng.uniform(0, 4.3, 1000)
    ours = prepare.galactic_to_xyz(l, b, d)
    ref = SkyCoord(l=l * u.deg, b=b * u.deg, distance=d * u.pc, frame="galactic").cartesian
    theirs = np.stack([ref.x.to_value(u.pc), ref.y.to_value(u.pc), ref.z.to_value(u.pc)], axis=1)
    assert np.allclose(ours, theirs, rtol=1e-9, atol=1e-9)


def test_distance_preference_and_snr_cut():
    df = pd.DataFrame({
        "r_med_photogeo": [100.0, np.nan, np.nan, np.nan],
        "r_med_geo":      [110.0, 200.0, np.nan, np.nan],
        "parallax":       [10.0,  5.0,   2.0,    0.5],
        "parallax_error": [0.1,   0.1,   0.1,    0.5],   # last one has SNR = 1
    })
    dist, src = prepare.choose_distance(df, min_snr=5)
    assert dist[0] == 100 and src[0] == 1   # photogeometric preferred
    assert dist[1] == 200 and src[1] == 2   # then geometric
    assert dist[2] == 500 and src[2] == 3   # then 1/parallax
    assert np.isnan(dist[3]) and src[3] == 0  # unreliable parallax dropped


def test_binary_layout(tmp_path):
    xyz = np.array([[0, 0, 0], [1.5, -2.0, 3.25]])
    path = tmp_path / "s.bin"
    prepare.write_bin(path, xyz, np.array([4.83, -10.0]), np.array([0.82, 4.5]))
    raw = path.read_bytes()
    assert raw[:4] == b"STR1"
    version, n, _ = struct.unpack("<III", raw[4:16])
    assert (version, n) == (1, 2)
    pos = np.frombuffer(raw[16:16 + n * 12], dtype="<f4").reshape(n, 3)
    assert np.allclose(pos, xyz)
    assert raw[16 + n * 12 + 1] == 0 and raw[16 + n * 13 + 1] == 255
    assert len(raw) == 16 + n * 14
