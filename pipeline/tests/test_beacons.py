import json
import struct

import numpy as np
import pandas as pd
from astropy.coordinates import SkyCoord
from astropy import units as u

from build_beacons import DETAIL, build, read_cepheids, read_masers, read_rrlyrae, read_apogee


def test_readers_and_tiles(tmp_path):
    cache = tmp_path/"cache"
    cache.mkdir()
    cep = read_cepheids(pd.DataFrame(dict(GLON=[0,90,180,0], GLAT=[0,0,90,0],
          Dist=[100.,100.,np.nan,-1.], e_Dist=[30.,30.01,0.,0.])))
    np.testing.assert_allclose(cep.loc[0,["x","y","z"]],[100.,0.,0.],atol=1e-8)
    np.testing.assert_allclose(cep.loc[1,["x","y","z"]],[0.,100.,0.],atol=1e-8)
    mas = read_masers(pd.DataFrame(dict(RAJ2000=["12 00 00"]*3,DEJ2000=["-30 00 00"]*3,
                                       plx=[.5,0.,-.5],e_plx=[.1,.1,.1])))
    coord = SkyCoord(180*u.deg,-30*u.deg).galactic.cartesian.xyz.value
    np.testing.assert_allclose(mas.loc[0,["x","y","z"]],2000*coord)
    assert mas.error[0]==400
    rr = read_rrlyrae(pd.DataFrame(dict(lon=[90]*4,lat=[0]*4,g=[12.79]*4,ag=[2,2,np.nan,2],
          feh=[-1.,np.nan,-1.,-1.],e_feh=[.1]*4,e_ag=[.05,.05,.05,2],e_g=[.01]*4,colour=[.5]*4)))
    # M_G=.79 and dereddened g=10.79 give distance modulus 10.
    assert np.isclose(rr.distance[0],1000) and np.isclose(rr.mag[0],.79)
    expected_sigma=np.sqrt(.01**2+.05**2+.032**2+.04**2+.06**2+.17**2)
    assert np.isclose(rr.error[0],1000*np.log(10)/5*expected_sigma)
    apo = read_apogee(pd.DataFrame(dict(RA=[180]*4,DEC=[-30]*4,DIST=[5000]*4,
                            DIST_ERROR=[1000,-9999,2000,1000],LOGG=[2.,2.,2.,4.5])))
    np.testing.assert_allclose(apo.loc[0,["x","y","z"]],5000*coord)
    for name,frame in zip(["cepheid","maser","rrlyrae","apogee"],[cep,mas,rr,apo]):
        frame.to_parquet(cache/(name+".parquet"),index=False)
    a,b=tmp_path/"a",tmp_path/"b"
    build(cache,a,capacity=1)
    build(cache,b,capacity=1)
    assert {p.name:p.read_bytes() for p in a.iterdir()}=={p.name:p.read_bytes() for p in b.iterdir()}
    meta=json.loads((a/"hierarchy.json").read_text())
    assert meta["survey"]=="beacons" and meta["format"]=="BCN1"
    assert [c["dropped"] for c in meta["catalogues"].values()]==[3,2,3,3]
    recovered={}
    for name,node in meta["nodes"].items():
        data=(a/(name+".bin")).read_bytes()
        n=node["count"]
        assert struct.unpack_from("<4sIII",data)==(b"BCN1",1,n,0)
        assert len(data)==16+n*(11+DETAIL.itemsize)
        offsets=np.frombuffer(data,"<i2",3*n,16).reshape(n,3)
        xyz=node["center"]+offsets*(node["half"]/32767)
        for row,pos in zip(np.frombuffer(data,DETAIL,n,16+11*n),xyz):
            recovered[row["kind"]]=row["distance"]
            assert np.isclose(np.linalg.norm(pos),row["distance"],atol=node["half"]/32767)
    assert recovered=={1:100,2:2000,3:1000,4:5000}
    (cache/"rrlyrae.parquet").unlink()
    build(cache,tmp_path/"partial")
    counts=json.loads((tmp_path/"partial/hierarchy.json").read_text())["catalogues"]
    assert counts["rrlyrae"]["status"]=="unavailable" and counts["rrlyrae"]["dropped"] is None
