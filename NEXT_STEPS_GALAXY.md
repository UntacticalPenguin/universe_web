# Universe Map: galaxy fixes

Brief for a coding agent, after `NEXT_STEPS.md` Steps 1–4. Read `AGENTS.md` first; its rules apply (one sub-step per session and pull request, stop at each gate, never download Gaia data in an agent session, never report performance you did not measure).

**Status 25 Nov 2026:** G1–G3c and the code for G4 and G5 are merged. G5's data waits for the Human to set the repository variable `GAIA_CLOUD_TABLE` once DR4 is out (2 Dec). Until then the OGLE layer is off by default (`?ogle=1` shows it).

**Next for the agent: Beacons** (section 8). Steps 5 (sound, fan-out actions) in `NEXT_STEPS.md` wait until Beacons is done.

## 1. What the Human sees, and why (measured 24 Nov 2026)

**The galaxy looks sparse.** The data is a bubble around the Sun, not a galaxy. Of the 7.3 M Gaia stars (G < 13):

| Distance from the Sun | Share |
| --- | --- |
| under 1 kpc | 56 % |
| under 3 kpc | 91 % |
| over 8 kpc (distance to the galactic centre) | 0.3 % |

The Milky Way's disc is about 30 kpc across, so the data covers roughly 4 % of its area. Reasons:

- the magnitude limit G < 13;
- dust: towards the galactic centre it dims visible light by about 30 magnitudes, so Gaia sees neither the centre nor the far side at any depth. The luminous-tracer layer (`build_luminous.py`) shows this: 46 of its 59,373 stars lie within 1 kpc of the centre;
- Gaia's total, 1.8 billion stars, is about 1 % of the Milky Way.

No catalogue shows the Milky Way from outside. The outside view needs a model (G3).

**Spokes radiating from the Sun are real, not errors.** In the plane (|b| < 5°), the number of stars beyond 3 kpc per 3° of longitude varies from 146 to 5,690. That count correlates with low dust at 1–2 kpc (Spearman −0.44), not with distance uncertainty (+0.03). Only 0.8 % of stars have a distance interval wider than ±20 %. The spokes are gaps in the dust. Do not filter them; the model layer (G3) and node glow (G1) soften them.

**Odd shapes at the bottom of the screen are the Large Magellanic Cloud** (33° below the plane, so always "down"). There are two causes:

1. Gaia's bright Cloud stars had Milky Way distances. Bailer-Jones distances assume every star belongs to the Milky Way, which put them at 2–20 kpc instead of 50–62 kpc: a streak toward the Clouds. **Fixed in G0.**
2. The OGLE-III layer (`build_lmc.py`) has three problems:
   - The survey's rectangular fields: 116 fields × 8 chips, about 40 square degrees, with gaps between them.
   - All 6 M entries sat at exactly 49.59 kpc, a paper-thin sheet. **Fixed in G0** (tilted disc).
   - It is about 1,000× denser per square degree than the rest of the sky (6 M in 40 deg² against 6 M in 41,253 deg²). It stays visible from everywhere. **G2** fades it with distance; **G5** replaces it.

## 2. G0: done (24 Nov 2026, not by the agent)

- `prepare.py`: `place_cloud_members` moves stars without a usable parallax (signal-to-noise below 5) that lie within 8° of the LMC or 4° of the SMC to the Clouds (49.59 and 62.44 kpc, with a 1 kpc spread). They get distance source code 4 and are exempt from `--max-dist`. On the real data, 2,646 stars move. They have a median M_G of −6, as expected for the Clouds' supergiants.
  - The streak towards the LMC shrinks from 1,853 to 737 excess stars at 2–20 kpc, compared with a field on the opposite side of the sky.
  - The rest have significant parallaxes and need proper motions to judge (G4).
  - Toward the SMC, most of the remaining excess is the globular cluster 47 Tucanae at about 4.5 kpc, which is real.
- `build_lmc.py`: OGLE entries are placed on the LMC's tilted disc: inclination 26.2°, line of nodes 154.5° (van der Marel & Kallivayalil 2014), distance formula from van der Marel & Cioni 2001, with a 500 pc spread. The north-east side is nearer.
- `deploy.yml`: the OGLE, deep-preview and luminous builds may fail without stopping the deploy. They depend on outside archives, and the Gaia archive is closed from 25 Nov to 2 Dec 2026.
- Tests: `pipeline/tests/test_clouds.py`.

**Human**: after the next deploy, look at the LMC from about 20 kpc away (`?focus=lmc`). Is it a tilted disc instead of a sheet? Is the streak towards it mostly gone?

## 3. G1: glow for distant tiles (viewer)

This is the missing part of `NEXT_STEPS.md` Step 4c. Tiles that are not refined (too far, or over budget) currently draw nothing. Their light belongs on screen.

- `viewer/src/lod/glow-layer.ts`: one soft point per selected-but-unrefined node, and per node whose children are still loading, at the node's `centroid`. Draw it into the HDR target so tone mapping, auto exposure and bloom apply.
  - Light: the node's `lSum` (or `lSum0` with dust off) minus the light of the stars it already draws. Use the same flux formula as stars, so light is conserved.
  - Colour: `meanBpRp` (or `meanLogTeff0` with dust off).
  - Size: the node's projected `half`, as a Gaussian with σ = half / 2, at least 2 px.
- When a node's children arrive, fade its glow out over 250 ms as the stars fade in, so nothing pops.
- Unit-test the light bookkeeping: drawn stars + glow = `lSum` for any refinement state.

**Gate G1 (Human)**: from 38 kpc (`?focus=milky-way`), the bubble around the Sun reads as one continuous glow, not separate dots. `?bench=1`: draw time rises by no more than 1 ms.

## 4. G2: Magellanic layer by distance (viewer)

- Fade the `lmc` survey's stars with camera distance from the LMC centre: full within 15 kpc, gone beyond 40 kpc, smooth in between. Beyond that, only its G1 node glow shows.
- Its colour is V − I, not BP − RP. Convert it with a fitted linear relation, written as a comment with its source, or keep it and say so in the hover text.
- Hover text already says "OGLE-III LMC field · disc model".

**Gate G2 (Human)**: from the Sun, the bottom of the sky shows the LMC as a faint smudge, not a dense patch with rectangles. Flying to it shows the full OGLE detail.

## 5. G3: model Milky Way (pipeline + viewer)

The outside view of the galaxy, clearly labelled as a model. Split it into G3a (pipeline) and G3b (viewer).

**G3a: `pipeline/build_model.py`** writes about 300,000 model particles: positions, luminosity and colour, sampled from a density model. Output is an STN1-like tile set `tiles/model/` with its own `hierarchy.json` and `"survey": "Milky Way model"`.

Components, with sources. Take numbers from the papers, write each with its citation next to the constant, and do not invent values:

| Component | Shape | Source |
| --- | --- | --- |
| Thin disc | exponential, scale length about 2.6 kpc, scale height about 0.3 kpc | Bland-Hawthorn & Gerhard 2016, review "The Galaxy in context" |
| Thick disc | exponential, shorter scale length, scale height about 0.9 kpc, about 12 % of thin-disc density at the Sun | same |
| Bar and bulge | boxy bar, half-length about 5 kpc, angle about 27–33° to the Sun–centre line | same |
| Spiral arms | logarithmic spirals: pitch angles, reference radii and widths per arm | Reid et al. 2019, ApJ 885, 131, Table 2 |
| Galactic centre position | 8.2 kpc from the Sun, Sun 20–25 pc above the plane | same review |

- **Colours** (temperatures for the existing lookup table): bulge and bar about 4,500 K, old disc about 5,500 K, arm particles mixed with 20 % young stars of 10,000–20,000 K.
- **Normalisation**: anchor it to the data, not to a literature total. Within 1 kpc of the Sun, the model's summed light per area equals the catalogue's (from `lSum` of the `stars` octree nodes in that region). Write the factor into `hierarchy.json`.
- **No double counting**: give each particle a flag or weight `inCatalogue`. Particles within 2 kpc of the Sun get weight 0; weights ramp up from 2 to 4 kpc.
- Tests:
  - densities integrate to the expected component fractions (±5 %);
  - the normalisation reproduces the anchor (±5 %);
  - deterministic with a fixed seed.

**G3b: viewer.**
- Draw the `model` survey as large soft splats (σ about 150 pc) into the HDR target.
- The layer fades in with camera distance from the Sun: 0 at 2 kpc, full at 8 kpc.
- Tray: toggle `model on / off`, default on. While it is drawn, the tray shows `model` so the viewer knows it is not observed data.
- Hover on a model splat: "Milky Way model (Bland-Hawthorn & Gerhard 2016; arms: Reid et al. 2019), not observed stars".

**Gate G3 (Human)**:
- from 38 kpc, a barred spiral is visible with the real-data bubble inside it at the Sun's position;
- from the Sun, nothing changes;
- `?bench=1&focus=milky-way`: draw time rises by no more than 3 ms.

**Optional, later (G3c)**: a dust layer that darkens the model's glow along each view ray (dust disc with a scale height of about 0.1 kpc), giving the dark lanes seen in photos of other spirals.

## 6. G4: Gaia DR4 refresh (from 2 Dec 2026; Human first)

The Gaia archive reopens with DR4 on 2 Dec 2026. Before any code:

1. **Human**: in the archive, check the DR4 table and column names, whether Bailer-Jones-style distances exist for DR4 yet, and the row count for G < 15 (`fetch_gaia.py --count` after updating the table names). Report them in an issue.
2. Then the agent updates `fetch_gaia.py`:
   - DR4 table names;
   - keep the GSP-Phot-like temperature and dust columns;
   - **add `pmra`, `pmdec`**, which G0's Cloud placement and G5 need;
   - bump `RAW_RELEASE` to `gaia-dr4-raw-v1`.
   - If DR4 has no distance table yet, stay on DR3 for distances and only take proper motions and photometry from DR4.
3. Extend `place_cloud_members` with a proper-motion test. Members move like their Cloud. Take the Clouds' mean proper motions from the Gaia Collaboration paper on the Magellanic Clouds (Luri et al. 2021, A&A 649, A7); do not invent them.
4. `build_luminous.py` sends anonymous jobs, which the archive has capped at 1 minute since October 2026; on 24 Nov every job was aborted. Log in with `GAIA_USER` / `GAIA_PASSWORD` the way `fetch_gaia.py` does. Until then the deploy reuses the last cached luminous layer.
5. Slices to G < 15: roughly 5× today's stars (an extrapolation from the current slices; check with `--count`). Add the slices one at a time and watch the octree build time and the Pages size limit (1 GB). Beyond that, tiles move to Cloudflare R2 (not yet).

## 7. G5: replace OGLE with Gaia's own Cloud stars (after G4)

- `pipeline/build_clouds.py`: query Gaia stars within 10° of the LMC and 5° of the SMC, down to G = 19, with the proper-motion and parallax membership cuts from Luri et al. 2021.
  - Place them on the disc geometry from `build_lmc.disc_distance` (and an SMC model from the same paper).
  - Write a `clouds` survey.
- This removes the rectangles and puts the Clouds in the same colour system as everything else. Then drop the `lmc` survey from the default set, or keep it as an option.

## 8. Beacons: real tracers across the whole galaxy (pipeline + viewer)

**Why.** Gaia sees a bubble of about 3 kpc around the Sun because it observes in visible light and dust blocks it (section 1). More Gaia stars do not change that: all of Gaia (G < 21, 1.8 billion stars, about 31 GB at 17 B/star) still ends in dust after a few kpc. The model (G3) shows the shape, but it is not data. Beacons are sparse real objects whose distances come from physics or radio parallaxes, not from Gaia parallaxes, and which reach across the galaxy. They let the Human see where the real galaxy is, and check the model's arms against them.

**Catalogues.** Download in `deploy.yml` only (the agent's firewall blocks them), cache each like the other layers, and use `continue-on-error`. Check every file name and column against the catalogue's ReadMe before relying on it; the notes below say what is confirmed.

| Beacon | Count | Source and download | Distance | Traces |
| --- | --- | --- | --- | --- |
| Classical Cepheids | about 2,400 (count from the paper's abstract; check the ReadMe) | Skowron et al. 2019, Science 365, 478. VizieR `J/other/Sci/365.478`, file `tables1.dat` (confirmed in the CDS listing), at `https://cdsarc.cds.unistra.fr/ftp/J/other/Sci/365.478/` | in the table, from mid-infrared period–luminosity relations | young disc, spiral arms and the warp, out to about 20 kpc |
| Masers in high-mass star-forming regions | about 200 | Reid et al. 2019, ApJ 885, 131. VizieR `J/ApJ/885/131` (confirmed), at `https://cdsarc.cds.unistra.fr/ftp/J/ApJ/885/131/` | 1 / parallax from radio interferometry (VLBI), which dust does not affect | spiral arms, including the far side; these are the points the G3 arm fits came from |
| RR Lyrae | 270,905 (confirmed, Clementini et al. 2023, A&A 674, A18) | Gaia DR3 table `gaiadr3.vari_rrlyrae`, joined to `gaia_source` for position and G. Archive reopens 2 Dec; until then check VizieR's Gaia DR3 copy (`I/358`) | from M_G = 0.32 [Fe/H] + 1.11 (Muraveva et al. 2018, MNRAS 481, 1195; check the coefficients in the paper) and the table's A_G. Use only stars with both [Fe/H] and A_G (A_G exists for 142,660 fundamental-mode stars) | old bulge and halo; the Clouds' and the Sagittarius stream's RR Lyrae land at their real distances |
| APOGEE red giants | about 650,000 (check the file) | SDSS DR17 astroNN value-added catalogue, folder `https://data.sdss.org/sas/dr17/env/APOGEE_ASTRO_NN/` (confirmed). Find the file name and distance column in the data model `https://data.sdss.org/datamodel/files/APOGEE_ASTRONN` | spectroscopic, from a neural network trained on Gaia parallaxes; infrared, so it sees through much of the dust | bar, bulge and inner disc, past the galactic centre |

**G-Beacons-a: `pipeline/build_beacons.py`**
- One reader function per catalogue, each returning galactic x, y, z (via `prepare.galactic_to_xyz`), absolute G or a stand-in, colour and a `kind` code (1 Cepheid, 2 maser, 3 RR Lyrae, 4 APOGEE giant).
- Drop entries without a distance or with a relative distance error above 30 %. Write how many were dropped, per kind, into `hierarchy.json`.
- Output: one octree, `tiles/beacons/`, with `"survey": "beacons"`, built with `build_octree`. If the tile format has no room for `kind`, add a new format version; do not change STN1.
- Tests with small synthetic tables in each catalogue's column layout: positions, the RR Lyrae distance formula, the error cut, a deterministic output.

**G-Beacons-b: viewer**
- Draw beacons as their own layer, on by default, with a tray toggle `beacons on / off`. They are few, so draw them all, at a minimum size of 2 px, without the brightness falloff normal stars get: they are markers, not light.
- One colour per kind, from the existing palette: Cepheids white, masers orange only while hovered (orange is reserved for what the user changes), RR Lyrae and APOGEE at two of the five white opacities. Show a small legend in the tray while beacons are on.
- Hover: kind, source paper, distance and its error.
- `?beacons=cepheid,maser` limits the kinds, for checking the model by eye.

**Gate Beacons (Human)**
- From 38 kpc (`?focus=milky-way`), the beacons span the disc well beyond the Gaia bubble: Cepheids and masers should lie along the model's arms, and RR Lyrae and APOGEE giants should crowd the centre.
- If the arms disagree with the beacons, the model is wrong, not the beacons. Report it; do not tune the model to match by hand.
- `?bench=1`: draw time rises by no more than 1 ms.

## 9. Not doing (and why)

- **Filtering stars by distance uncertainty**: measured above, it would not remove the spokes.
- **Pre-rendered parallax background shells**: wait until G3 shows whether the far field still needs them.
