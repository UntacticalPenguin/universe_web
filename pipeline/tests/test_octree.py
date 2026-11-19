"""Decode STN1 tiles independently and verify the hierarchy against original rows."""
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_octree
import prepare


def test_catalog_partition_and_summaries(tmp_path):
    rng = np.random.default_rng(91)
    n = 20000
    # An integer lattice uniquely identifies the source row even after tile quantisation.
    grid = rng.choice(200**3, n, replace=False)
    xyz = np.column_stack(np.unravel_index(grid, (200,)*3)).astype(float) - 100
    lookup = {tuple(pos): i for i, pos in enumerate(xyz)}
    mag, colour = rng.uniform(-8, 18, n), rng.uniform(-0.2, 3, n)
    ag, red, teff = rng.uniform(0, 2, n), rng.uniform(0, .4, n), rng.uniform(3000, 12000, n)
    ag[::3] = np.nan
    red[::4] = np.nan
    teff[::5] = np.nan
    build_octree.build_octree(tmp_path, xyz, mag, colour, dict(teff=teff, ag=ag, ebpminrp=red), 256)
    manifest = json.loads((tmp_path / "hierarchy.json").read_text())
    nodes = manifest["nodes"]
    assert nodes["r"]["half"] == 128 and manifest["format"] == "STN1"
    lum = 10**(-.4*(mag-4.83))
    lum0 = lum * 10**(.4*np.nan_to_num(ag))
    intrinsic = np.where(np.isfinite(teff), teff, prepare.temperature_of(colour - np.nan_to_num(red)))
    def inspect(name):
        node = nodes[name]
        data = (tmp_path / (name+".bin")).read_bytes()
        magic, version, count, reserved = struct.unpack_from("<4sIII", data)
        assert (magic, version, count, reserved) == (b"STN1", 1, node["count"], 0)
        assert len(data) == 16 + count*11
        center, half = np.array(node["center"]), node["half"]
        offset = np.frombuffer(data, "<i2", 3*count, 16).reshape(-1,3)
        pos = center + offset * (half/32767)
        rows = np.array([lookup[tuple(v)] for v in np.rint(pos)])
        assert np.all(np.abs(xyz[rows] - center) <= half)
        assert np.max(np.linalg.norm(pos-xyz[rows], axis=1)) <= half*np.sqrt(3)/32767
        channels = np.frombuffer(data, np.uint8, 5*count, 16+count*6).reshape(5,count)
        expected = [prepare.quantise(mag[rows],-10,20), prepare.quantise(colour[rows],-.5,4.5),
                    prepare.quantise_optional(np.log10(teff[rows]),3.3,4.7),
                    prepare.quantise_optional(ag[rows],0,8), prepare.quantise_optional(red[rows],0,4)]
        np.testing.assert_array_equal(channels,expected)
        for child in node["children"]:
            assert mag[rows].max() <= nodes[child]["mMin"]
        group = np.concatenate([rows]+[inspect(child) for child in node["children"]])
        assert node["subtreeCount"] == len(group) and node["mMin"] == mag[group].min()
        for key, weights in [("lSum",lum),("lSum0",lum0)]:
            total = weights[rows].sum()+sum(nodes[c][key] for c in node["children"])
            np.testing.assert_allclose(node[key], total, rtol=1e-9)
        np.testing.assert_allclose(node["centroid"], np.average(xyz[group],axis=0,weights=lum[group]))
        np.testing.assert_allclose(node["meanBpRp"], np.average(colour[group],weights=lum[group]))
        np.testing.assert_allclose(node["meanLogTeff0"], np.average(np.log10(intrinsic[group]),weights=lum0[group]))
        return group
    np.testing.assert_array_equal(np.sort(inspect("r")),np.arange(n))


def test_cli_limit_without_dust(tmp_path, monkeypatch):
    source = tmp_path / "stars.csv"
    pd.DataFrame(dict(l=[0,90,180], b=[0,0,0], r_med_geo=[10,20,30], phot_g_mean_mag=[16,8,10])).to_csv(source,index=False)
    out = tmp_path / "tiles"
    monkeypatch.setattr(sys,"argv",["build_octree.py",str(source),"--limit","2","--out",str(out)])
    build_octree.main()
    root = json.loads((out/"hierarchy.json").read_text())["nodes"]["r"]
    assert root["count"] == 3 and root["half"] == 32
    assert (out/"r.bin").read_bytes()[-9:] == bytes([255])*9


def test_temperature_matches_viewer_reference():
    bp = np.array([-.1,0,.82,2,3])
    np.testing.assert_allclose(prepare.temperature_of(bp),[11412.345712558335,10225.197808886183,5683.94376558658,3678.5636084957305,2959.8308668076106],rtol=1e-10)
