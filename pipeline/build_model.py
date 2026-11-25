"""Build a labelled, luminosity-calibrated Milky Way density model in parsecs."""
import argparse
import json
import struct
from pathlib import Path

import numpy as np

# Bland-Hawthorn & Gerhard (2016), sections 3–5: distances in kpc, masses in 1e10 Msun.
R0, ZSUN = 8.2, .025
THIN_R, THIN_Z, THICK_R, THICK_Z, LOCAL_RATIO = 2.6, .3, 2., .9, .12
BAR_LENGTH, BAR_ANGLE, BAR_MASS, DISC_MASS = 5., 27., 1.5, 5.17
# Boxy bar axis ratios 1:0.4:0.3 (Bland-Hawthorn & Gerhard, section 4).
BAR_AXES = np.array([1., .4, .3]) * BAR_LENGTH
# Spiral mass as fraction of disc, MNRAS stag1641, Galactic model.
ARM_SHARE = .094
# Reid et al. (2019), ApJ 885, 131, Table 2. Measured azimuth interval,
# kink azimuth and radius, two pitch angles and Gaussian arm width (degrees, kpc).
ARMS = np.array([
    [15,18,15,3.52,-4.2,-4.2,.18], [5,54,18,4.46,-1.,19.5,.14],
    [0,104,23,4.91,14.1,12.1,.23], [2,97,24,6.04,17.1,1.,.27],
    [-8,34,9,8.26,11.4,11.4,.31], [-23,115,40,8.87,10.3,8.7,.35],
    [-16,71,18,12.24,3.,9.4,.65],
])


def fractions():
    """Integrate exponential discs, converting the local midplane ratio to mass."""
    ratio = LOCAL_RATIO * np.exp(R0*(1/THICK_R-1/THIN_R)) * THICK_R**2*THICK_Z/(THIN_R**2*THIN_Z)
    disc = DISC_MASS/(DISC_MASS+BAR_MASS)
    thick = disc*ratio/(1+ratio)
    return np.array([disc-thick-disc*ARM_SHARE, thick, 1-disc, disc*ARM_SHARE])


def sample(count, seed):
    """Sample thin disc, thick disc, boxy bar and fitted arm segments."""
    rng = np.random.default_rng(seed)
    component = rng.choice(4, count, p=fractions())
    thick = component == 1
    radius = rng.gamma(2, np.where(thick, THICK_R, THIN_R))
    phi = rng.uniform(-np.pi,np.pi,count)
    z = rng.laplace(0,np.where(thick,THICK_Z,THIN_Z))
    arm = component == 3
    lengths = np.diff(ARMS[:,:2],axis=1).ravel()*ARMS[:,3]
    low,high,kink,rk,p1,p2,width = ARMS[rng.choice(len(ARMS),sum(arm),p=lengths/lengths.sum())].T
    angle = rng.uniform(low,high)
    phi[arm] = np.deg2rad(angle)
    radius[arm] = rk*np.exp(-np.deg2rad(angle-kink)*np.tan(np.deg2rad(np.where(angle<kink,p1,p2)))) + rng.normal(0,width)
    x,y = radius*np.cos(phi),radius*np.sin(phi)
    bar = component == 2
    # Uniform directions in a boxy (L4) ellipsoid, centrally weighted by a
    # triangular radial density. This is a rendering profile, not a fitted density law.
    direction = rng.gamma(.25,1,(bar.sum(),3))
    direction = (direction/direction.sum(axis=1)[:,None])**.25 * rng.choice([-1,1],direction.shape)
    a,b,zbar = (direction * rng.beta(3,2,bar.sum())[:,None]*BAR_AXES).T
    theta = np.deg2rad(BAR_ANGLE)
    x[bar],y[bar],z[bar] = a*np.cos(theta)-b*np.sin(theta),a*np.sin(theta)+b*np.cos(theta),zbar
    xyz = np.column_stack([R0-x,y,z-ZSUN])*1000
    # Population colours prescribed by NEXT_STEPS_GALAXY G3a.
    temperature = np.where(bar,4500.,5500.)
    young = arm & (rng.random(count)<.2)
    temperature[young] = rng.uniform(10000,20000,young.sum())
    return xyz, temperature, component


def build(out, anchor, count=300000, seed=42):
    """Normalize the unmasked population first, then store the catalogue overlap weight."""
    xyz,temp,component = sample(count,seed)
    distance = np.linalg.norm(xyz,axis=1)
    nearby = int(np.count_nonzero(distance<1000))
    if not nearby or not np.isfinite(anchor) or anchor<=0:
        raise ValueError("positive model and catalogue light required inside the 1 kpc anchor")
    factor = anchor/nearby
    weight = np.clip((distance-2000)/2000,0,1)
    out.mkdir(parents=True,exist_ok=True)
    tiles = {}
    # Each octant file holds disjoint rows: XYZ(pc), luminosity(Lsun), K, overlap weight.
    octant = (xyz[:,0]>8200).astype(int)+2*(xyz[:,1]>0)+4*(xyz[:,2]>0)
    for i in np.unique(octant):
        mask = octant==i
        data = np.column_stack([xyz[mask],np.full(mask.sum(),factor),temp[mask],weight[mask]]).astype('<f4')
        name = 'r'+str(i)
        (out/(name+'.bin')).write_bytes(struct.pack('<4sIII',b'MWM1',1,len(data),0)+data.tobytes())
        tiles[name] = dict(count=len(data),min=data[:,:3].min(axis=0).tolist(),max=data[:,:3].max(axis=0).tolist())
    meta = dict(survey="Milky Way model",format="MWM1",version=1,tiles=tiles,count=count,seed=seed,
                normalization=factor,anchorLuminosity=anchor,anchorParticles=nearby,
                componentCounts=np.bincount(component,minlength=4).tolist())
    (out/'hierarchy.json').write_text(json.dumps(meta))
    return meta


def anchor_light(path):
    """Use exact subtree totals inside the anchor and decode only boundary payloads."""
    from prepare import M_MIN, M_MAX, SUN_M
    tree = json.loads(path.read_text())
    nodes = tree["nodes"]

    def visit(name):
        node = nodes[name]
        center = np.abs(node["center"])
        half = node["half"]
        if np.linalg.norm(center+half) < 1000:
            return node["lSum"]
        if np.linalg.norm(np.maximum(center-half,0)) >= 1000:
            return 0.
        n = node["count"]
        raw = path.with_name(name+".bin").read_bytes()
        if len(raw)!=16+11*n or struct.unpack_from("<4sIII",raw)!=(b"STN1",1,n,0):
            raise ValueError("invalid anchor tile "+name)
        offsets = np.frombuffer(raw,"<i2",3*n,16).reshape(n,3)
        xyz = node["center"]+offsets*(half/32767)
        mag = M_MIN+np.frombuffer(raw,"u1",n,16+6*n)*((M_MAX-M_MIN)/255)
        lum = 10**(-.4*(mag-SUN_M))
        # Distribute the exact payload total by the quantised per-star light.
        own = node["lSum"]-sum(nodes[ch]["lSum"] for ch in node["children"])
        return own*(lum[np.linalg.norm(xyz,axis=1)<1000].sum()/lum.sum())+sum(visit(ch) for ch in node["children"])

    return visit(tree["root"])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stars',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    build(args.out,anchor_light(args.stars))
