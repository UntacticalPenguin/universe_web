import numpy as np

from build_synthetic import ANCHOR_PC, FADE_IN, magnitude_cut, synthesise


def local_catalog(n=20000, seed=3):
    rng = np.random.default_rng(seed)
    xyz = rng.uniform(-ANCHOR_PC, ANCHOR_PC, (n, 3))
    absmag = rng.uniform(-5, 8, n)
    colour = rng.uniform(-0.3, 2.5, n)
    return xyz, absmag, colour


def test_cut_fits_budget_and_is_brightest_that_fits():
    mag = np.linspace(-5, 8, 1000)
    cut, total = magnitude_cut(mag, 0.01, 50000)
    assert total <= 50000
    assert np.count_nonzero(mag < cut + 0.25) / 0.01 > 50000 or cut == 1.0


def test_synthetic_stars_avoid_bubble_and_copy_real_values():
    xyz, absmag, colour = local_catalog()
    pos, mag, col, cut, count = synthesise(xyz, absmag, colour, max_count=200000)
    r = np.linalg.norm(pos, axis=1)
    assert len(pos) <= count <= 200000
    assert np.all(r >= FADE_IN[0])
    assert np.all(mag < cut)
    assert np.isin(mag, absmag).all() and np.isin(col, colour).all()


def test_deterministic():
    xyz, absmag, colour = local_catalog()
    a = synthesise(xyz, absmag, colour, max_count=100000)
    b = synthesise(xyz, absmag, colour, max_count=100000)
    assert np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1])
