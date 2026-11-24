# Universe Map: next steps

Brief for a coding agent (GitHub Copilot cloud agent or any other) working in this repository. Read `AGENTS.md` first.

- Work through the steps in order.
- Do one sub-step per session and per pull request.
- Stop at each gate and report.
- A human (the project owner, "Human") does everything marked **Human**: settings, secrets and all performance measurements.

**Current checkpoint (24 Nov 2026): Steps 2–4 are implemented, except the node glow from Step 4c. Continue with [`NEXT_STEPS_GALAXY.md`](NEXT_STEPS_GALAXY.md), starting at G1; Step 5 below waits until G1–G3 are done.** Gate 2 hardware measurements remain open.

## 1. Context

Universe Map is a browser-based 3D map of the observable universe built from real catalogs. Current focus: **exploration only**, with the Spaceship-style interface and sound. The idle-game layer is paused.

```
pipeline/   Python: download catalog data and turn it into compact binary files
viewer/     TypeScript + three.js (Vite): the website
.github/    deploy.yml builds real data + the site; copilot-setup-steps.yml prepares the agent's environment
docs/       measurements.md (filled in by the Human), star-colours.png (visual reference for Step 2)
```

Current state, v0.5:

- `pipeline/fetch_gaia.py` downloads Gaia DR3 stars joined with Bailer-Jones distances, one magnitude slice per run.
  - Columns: l, b, parallax and its error, RUWE, G, BP−RP, Gaia's GSP-Phot temperature and dust (`teff_gspphot`, `ag_gspphot`, `ebpminrp_gspphot`) and the Bailer-Jones distances.
  - `--count` prints a slice's row count; `--print-name` prints a slice's file name.
  - It logs in automatically when the environment variables `GAIA_USER` and `GAIA_PASSWORD` are set.
- `pipeline/prepare.py` writes `stars.bin` (format documented at the top of the script). `--limit N` keeps only the N brightest stars.
  - Version 1: 14 bytes per star (position, absolute magnitude, colour). The bundled sample is version 1.
  - Version 2: 17 bytes per star; adds temperature, dust extinction A_G and dust reddening E(BP−RP), each one byte, 255 = unknown. Written when the input has the GSP-Phot columns.
- The viewer loads one star file (version 1 or 2) and draws every star in one draw call.
  - Brightness follows the apparent magnitude seen from the camera. Colour comes from a blackbody lookup table indexed by `bp_rp`.
  - It only redraws when the view changes.
  - Hovering a star frames it with brackets and a readout; clicking flies to it.
  - The left rail is a logarithmic distance ruler; the tray at the bottom has knobs for magnitude limit and exposure.
  - `loadStars` returns the version 2 arrays (`teff`, `extinction`, `reddening`) and helpers `gspTemperatureOf`, `extinctionOf`, `reddeningOf`; for version 1 files every value is unknown. Nothing uses them yet.
- URL parameters:
  - `?stars=<file>.bin` loads another file from `viewer/public/data/`.
  - `?bench=1` orbits continuously and shows `draw ms`, the median time to draw a frame including GPU work.
- `.github/workflows/deploy.yml` runs on every push to `main`.
  - It gets each Gaia slice from the Actions cache, else from the GitHub release `gaia-dr3-raw-v2` (where it stores every slice it downloads), else from the Gaia archive.
  - It builds `stars.bin` (1 M stars) plus `stars-1m.bin`, `stars-3m.bin` and `stars-6m.bin`, and `tiles/stars/` once `pipeline/build_octree.py` exists. Then it publishes everything to GitHub Pages.

Two problems the Human sees on the deployed site, which Step 2 fixes:

1. **Zoomed out, everything goes dark; zoomed in, the screen fills with white.** Each star is drawn alone: stars fainter than the magnitude knob are discarded, and the brightness scale is measured relative to that same limit, so bright stars saturate to white. Real galaxies seen from outside are bright because billions of faint stars add up (10,000 stars of m = 17 in one pixel give as much light as one star of m = 7). The viewer throws that light away instead of adding it.
2. **Stars look only yellow and white.** Real star colours are pale (the Sun is RGB 255, 239, 228; a 30,000 K star 162, 187, 255), overlapping stars clip to white, and dust reddens distant stars.

## 2. Ground rules

- Order: Step 1 (Human only, done), then 2, 3, 4 and 5. Do not start other roadmap items: background shells, nebulae, galaxies or any game feature.
- After every change:
  - `cd pipeline && python -m pytest tests`;
  - `cd viewer && npm run build`, and from Step 2a on also `npm test`.

  All must pass. Run `npm run format` before finishing.
- Never break the `stars.bin` version 1 or 2 formats or their loader. New formats get new names and versions.
- Code style: see `AGENTS.md`.
- Never commit data files. Never download Gaia data in an agent session: the agent's firewall blocks the archive, and real data comes from `deploy.yml`.
- Test with synthetic data and with the bundled sample `viewer/public/data/stars.bin` (about 146,000 stars, version 1). For version 2 code paths, write a small synthetic version 2 file in a test (see `pipeline/tests/test_prepare.py` for the layout).
- Never report performance numbers you did not measure. Performance gates are measured by the Human on the deployed site.

## 3. Where the data comes from

| Source | Address | Used for | Access |
| --- | --- | --- | --- |
| ESA Gaia Archive (ADQL) | https://gea.esac.esa.int/archive/ | `gaiadr3.gaia_source` joined with `external.gaiaedr3_distance` | `fetch_gaia.py`, run by `deploy.yml` on GitHub Actions |
| Gaia archive account | https://www.cosmos.esa.int/web/gaia-users/register | Required: anonymous queries are too limited for this data | Done: repository secrets `GAIA_USER` and `GAIA_PASSWORD` |
| Release `gaia-dr3-raw-v2` | this repository's Releases page | The downloaded Parquet slices, kept so builds work while the archive is closed | Written and read by `deploy.yml` |
| Bailer-Jones distances | https://bailer-jones.www3.mpia.de/gedr3_distances.html | Explains the distance columns | Already joined in the query |
| GSP-Phot astrophysical parameters | Gaia DR3 documentation, chapter 11 (Astrophysical parameters) | Explains `teff_gspphot`, `ag_gspphot`, `ebpminrp_gspphot` | Already in the query |
| ESA bulk files | https://cdn.gea.esac.esa.int/Gaia/gdr3/ | Later only (full catalog) | Not now |
| LIneA HATS Parquet copy | https://data.linea.org.br/en/lsdb/gaia_dr3.html | Later only | Not now |

Archive limits since the archive's October 2026 release ([user quotas](https://www.cosmos.esa.int/web/gaia-users/archive/collaborate#GaiaArchiveUserQuotas)): without an account, asynchronous jobs stop after **1 minute** and **50,000 rows**. With an account: a 120-minute timeout, no row limit and 20 GB of stored results. The archive is closed from 25 November 2026, 12:00 CET, until the Gaia DR4 release on 2 December 2026; builds in that week use the release copy.

GSP-Phot caveats: values exist only for stars GSP-Phot fitted: 57.6 % of `stars-1m.bin`, 59.1 % of `stars-3m.bin`, 62.0 % of `stars-6m.bin` (fewer among the brightest stars); A_G and E(BP−RP) are estimates along the line of sight from Earth and are known to be biased for some stars. Use them, but label the views that depend on them.

## 4. Step 1: real data online and measured (Human), done

Done on 17 November 2026: 7,311,530 stars with G < 13 downloaded; `stars-1m/3m/6m.bin` built; `draw ms` ≈ 5 / 10 / 20, so draw time ≈ 1.6 ms + 3.0 ms per million stars. Details in `docs/measurements.md`.

Remaining for the **Human**:

1. Fill in the machine table in `docs/measurements.md`: laptop model, GPU, browser, window size.
2. Done on 18 November 2026: the files are version 2, and the release `gaia-dr3-raw-v2` holds all five slices (561 MB).

**Gate 1**: passed.

## 5. Light and colour: the target

Build Step 2 against the reference image `docs/star-colours.png`: seven star temperatures drawn four ways.

- Row 1 is roughly today's look.
- Row 2 (colour-preserving tone mapping with a soft halo) is the new default.
- Row 3 (saturation ×2) is the optional "enhanced" view.
- Row 4 (white core, coloured halo, diffraction spikes) is the optional photographic look.

Principle: the default shows real colours and real brightness ratios. Anything that departs from that (saturation above ×1, dust removed, spikes) is off by default and labelled in the tray while it is on.

## 6. Step 2: light and colour (viewer)

Split this into two pull requests, in order. Both work on the current single-file viewer; Step 4 reuses the result for tiles.

**2a: HDR light, tone mapping, automatic exposure.**

- **Tests**: add vitest as a dev dependency with an `npm test` script. Put the maths in pure functions (`viewer/src/render/light.ts`) and unit-test them: flux from magnitude, point size, the tone curve, the exposure update.
- **HDR target** (`viewer/src/render/hdr-target.ts`): stars draw into a half-float render target (`THREE.HalfFloatType`) at canvas size × pixel ratio, additive blending, cleared to black each frame. Resize it with the canvas.
- **Star shader** (`viewer/src/stars/stars-layer.ts`), linear light only:
  - Flux on a fixed scale: `flux = 10^(−0.4 · (m − 6))`, so a star of apparent magnitude 6 has flux 1. It no longer depends on the magnitude knob.
  - No per-star saturation: remove `1 − exp(−0.08 · flux)`.
  - Light is conserved: a star deposits its whole flux spread over its sprite. Divide the profile `exp(−4 r²)` by its integral in pixels, π · (1 − e⁻⁴) / 4 · (size / 2)², so the total is independent of point size. Ten thousand faint stars in one pixel must add up to the flux of their sum (unit-test the normalisation).
  - Colour normalised to luminance 1 (divide the lookup-table colour by 0.2126 R + 0.7152 G + 0.0722 B), so flux alone sets brightness.
  - Point size from the light that will reach the screen: `size = clamp(1.5 + 2.5 · log10(1 + flux · exposure), 1.5, 16)` CSS pixels × pixel ratio. Most stars stay 1.5 px; only bright ones grow.
  - The magnitude knob becomes a pure performance cut-off ("draw stars brighter than"). Its range gains a top position `all`, which is the new default.
- **Tone mapping** (`viewer/src/render/tone-map.ts`), a full-screen pass from the HDR target to the canvas:
  1. multiply by the exposure;
  2. compute luminance L and replace the colour by `rgb × T(L) / L`, with `T(L) = L · (1 + L / 16) / (1 + L)` (extended Reinhard, white at L = 4). This compresses brightness but keeps hue;
  3. if any channel is still above 1, divide the whole colour by its largest channel (hue kept, never clipped per channel);
  4. convert to sRGB.
- **Automatic exposure** (`viewer/src/render/auto-exposure.ts`):
  - After drawing, reduce the HDR target's luminance to one value: the arithmetic mean over the frame. Do it on the GPU (successive half-size passes into small half-float targets, or mipmaps), then read back the final 1 × 1 pixel with `readPixels`, at most every 4th frame.
  - Target exposure: `key / mean`, with `key = 0.02` (a mostly black sky), clamped to ±10 stops around the default. Move towards it with a time constant of 0.5 s.
  - While the exposure is still changing by more than 1 % per frame, keep requesting frames (adaptation counts as "the view changed").
  - The `exp` knob becomes an offset in stops on top of the automatic value. A tray toggle `auto` / `fixed` switches adaptation off; `fixed` keeps the current value.
- **Picking**: `pointSizeOf` in `stars-layer.ts` and `screen-index.ts` must follow the new size formula and the current exposure.
- **Bench**: `draw ms` includes all passes.

**2b: colour options.**

- **Temperature in the shader**: index the colour lookup table by log10 temperature (2,000 K to 50,000 K, 256 entries) instead of `bp_rp`. Compute the temperature per star in the vertex shader:
  - **dust on** (default, "as seen from Earth"): from observed `bp_rp`, with the Mucciarelli & Bellazzini formula already in `colour-lut.ts`;
  - **dust off**: from `teff_gspphot` if known, else from `bp_rp − E(BP−RP)` if known, else from `bp_rp`. Brightness uses M − A_G where A_G is known.
  - Upload the three version 2 byte arrays as attributes; for version 1 files they are all 255 and dust off changes nothing.
- **Tray**:
  - a toggle `dust on` / `dust off`. While off, the tray shows `no dust`, and how many loaded stars had no dust value, e.g. `no dust · 38 % unknown` (GSP-Phot fitted only about 60 % of the stars in the deployed files);
  - a knob `sat`, ×1.0 to ×3.0, default ×1.0, applied in the tone-mapping pass after step 2 as `Y + k · (rgb − Y)` with luminance Y kept, then clamped at 0. While above ×1.0 the tray shows `enhanced`;
  - a knob `glow`, 0 to 20 %, default 4 %;
  - a toggle `spikes`, off by default.
- **Glow** (`viewer/src/render/glow.ts`): a bloom from the HDR target: five half-size levels, each blurred, added back before tone mapping with weight `glow`. Because tone mapping keeps hue, halos show the star's colour (row 2 of the reference).
- **Spikes**: in the star fragment shader, stars whose sprite is at least 8 px get two thin perpendicular lines through the centre carrying 3 % of their flux; while spikes are on, the size limit for those stars rises to 48 px. Row 4 of the reference.
- **Readout** on hover: temperature with its source (`GSP-Phot` or `from colour`); A_G and E(BP−RP) when known.
- Known limitation, write it in the help text later: dust on shows colours as seen from Earth. From far away the dust along other lines of sight differs; the proper fix is a 3D dust map, which is out of scope.

**Gate 2 (Human, on the deployed site, with `stars-6m.bin`)**:
- from about 30 kpc away (drag the rail), the Milky Way's stars form a visible glow instead of disappearing;
- at the Sun, the screen no longer fills with white, and bright stars keep their colour in their halos;
- `dust off` shows more blue stars along the Milky Way band;
- `sat` above ×1.0 shows `enhanced`; spikes appear only when switched on;
- `?bench=1&stars=stars-3m.bin`: `draw ms` at most 13 (baseline 10). Record it in `docs/measurements.md`.

## 7. Step 3: octree tiles (pipeline)

Write `pipeline/build_octree.py` and `pipeline/tests/test_octree.py` in one pull request. Test only with synthetic stars and the sample data.

### 7.1 Algorithm

1. Load the Parquet or CSV inputs exactly as `prepare.py` does, reusing its helpers (`load`, `choose_distance`, `galactic_to_xyz`, `astrophysics_of`, the quantisers): x, y, z (pc, float64, heliocentric galactic), absolute magnitude M, `bp_rp`, and the GSP-Phot temperature, A_G and E(BP−RP) (NaN where missing; all NaN for inputs without those columns). Support `--limit N` the same way.
2. The root cube is centred on the Sun. Its half-size is the smallest power of two in parsecs that contains every star.
3. Sort all stars by M, brightest (lowest M) first.
4. Partition recursively.
   - A node keeps the first `capacity` stars that fall inside it (default 32,768, set with `--capacity`).
   - The rest are split into its 8 octants by comparing positions with the node's centre. Each non-empty octant becomes a child.
   - Stop at depth 21, or when the remaining stars fit in the node.
   - Use numpy index arrays, not per-star Python loops: 6 M stars must build in minutes.
5. Shuffle the stars stored in each node with a fixed seed, so any prefix of a tile is an even random sample.
6. For every node, summarise its whole subtree:
   - `subtreeCount`: number of stars;
   - `lSum`: total luminosity in solar units, with L = 10^(−0.4·(M − 4.83));
   - `centroid`: luminosity-weighted mean position, float64;
   - `meanBpRp`: luminosity-weighted mean `bp_rp` (observed colour, dust included);
   - `lSum0`: the same as `lSum` with dust removed, using M − A_G where A_G is known and M otherwise;
   - `meanLogTeff0`: dust-free colour as the `lSum0`-weighted mean of log10 temperature. Per star, take `teff_gspphot` if known, else the temperature of `bp_rp − E(BP−RP)` if known, else of `bp_rp`. Add `temperature_of(bp_rp)` to `prepare.py`, matching `temperatureOf` in `viewer/src/stars/colour-lut.ts`, with a test that both agree on a few values;
   - `mMin`: the brightest M in the subtree.

### 7.2 Output (`--out`, normally `viewer/public/tiles/stars/`)

**One `<id>.bin` per node.** Ids are octant paths: `r`, then `r0`…`r7`, then `r05`, and so on. Little-endian, version 1:

```
bytes 0-3     magic "STN1"
bytes 4-7     uint32 version (1)
bytes 8-11    uint32 count
bytes 12-15   uint32 reserved (0)
then          count × 3 int16   position relative to the node centre: round(offset / half × 32767)
then          count × uint8     absolute magnitude, quantised like prepare.py (M from −10 to 20)
then          count × uint8     colour, quantised like prepare.py (bp_rp from −0.5 to 4.5)
then          count × uint8     temperature, quantised like prepare.py version 2 (255 = unknown)
then          count × uint8     dust extinction A_G, quantised like prepare.py version 2 (255 = unknown)
then          count × uint8     dust reddening E(BP−RP), quantised like prepare.py version 2 (255 = unknown)
```

The file size is exactly 16 + 11 × count bytes.

**One `hierarchy.json`:**

```json
{
  "version": 1, "format": "STN1", "capacity": 32768,
  "absmagRange": [-10, 20], "colourRange": [-0.5, 4.5],
  "teffLogRange": [3.3, 4.7], "agRange": [0, 8], "reddeningRange": [0, 4], "root": "r",
  "nodes": {
    "r": { "center": [0, 0, 0], "half": 16384, "count": 32768, "subtreeCount": 6000001,
           "mMin": -9.1, "lSum": 1.2e9, "lSum0": 2.5e9, "centroid": [12.3, -4.5, 1.2],
           "meanBpRp": 1.1, "meanLogTeff0": 3.72,
           "children": ["r0", "r1", "r4"] }
  }
}
```

The numbers above are placeholders. Keep `center` and `centroid` at full float64 precision. The script prints node count, maximum depth, total bytes and build time.

### 7.3 Tests (about 20,000 synthetic stars)

1. Every input star is stored in exactly one node.
2. Every stored star lies inside its node's cube.
3. Brighter stars sit higher in the tree: the faintest star stored in a parent is no fainter than the brightest star in any of its children.
4. A node's `lSum` equals its stored stars' luminosity plus its children's `lSum` (relative tolerance 1e-9); the same for `lSum0`.
5. Decoding a tile reproduces positions within half × √3 / 32767.
6. Every tile file is 16 + 11 × count bytes and starts with `STN1`.
7. Unknown GSP-Phot values stay 255 in the tiles, and inputs without GSP-Phot columns still build.

The command `python build_octree.py data/raw/*.parquet --limit 6000000 --out ../viewer/public/tiles/stars` must work as written, because `deploy.yml` calls it.

**Gate 3**: tests pass. After merging, the deploy run builds tiles; the Human checks the run summary.

## 8. Step 4: stream tiles in the viewer

Split this into three pull requests, in order.

**4a: selection, with unit tests.** Create `viewer/src/lod/hierarchy.ts` and `viewer/src/lod/select-nodes.ts` (vitest is set up in Step 2a). `select-nodes.ts` is a pure function. Given the hierarchy, camera, viewport, magnitude limit and point budget, it returns:
- which loaded nodes to draw;
- which nodes to request;
- which unrefined nodes to draw as glows.

Rules:
1. Max-heap ordered by projected size: node diameter ÷ distance × focal length in pixels.
2. Skip any node, and its subtree, whose box is outside the frustum.
3. Skip any node, and its subtree, where `mMin + 5·log10(max(dNear, 1e-6) / 10) > magLimit`. Here `dNear` is the distance from the camera to the nearest point of the node's box.
4. Draw a loaded node while its `count` fits in the budget. The budget defaults to 3,000,000; `?budget=` overrides it.
5. Refine a node into its children only when its projected size exceeds 300 px and the children are loaded. Otherwise, request them and draw the node as a glow.

Unit-test it on a small hand-made hierarchy.

**4b: loading.** Create these modules:
- `decode-worker.ts`: a Web Worker that fetches a tile, checks its header and returns the typed arrays as transferables;
- `tile-loader.ts`: a priority queue with at most 6 requests in flight; AbortController cancels requests for nodes no longer wanted;
- `tile-cache.ts`: an LRU cache with a 256 MB budget that disposes GPU buffers on eviction.

**4c: drawing and wiring.**
- `node-points.ts`: one `THREE.Points` per loaded node, drawn relative to the camera:
  - every frame, compute `offset = node.center − camera.position` in JavaScript (float64);
  - pass `offset` and `half` as uniforms;
  - the vertex shader computes `p = uOffset + aPos × uHalf` (`aPos` a normalised int16 attribute) and applies the camera's rotation only;
  - flux, point size, colour and the dust switch reuse the shader code from Step 2 (move it into a shared GLSL chunk rather than copying it);
  - stars draw into the same HDR target, so tone mapping, auto exposure and glow apply unchanged.
- `glow-layer.ts`: one soft point per unrefined node at its `centroid`, drawn into the HDR target. Brightness from `lSum` (or `lSum0` with dust off), colour from `meanBpRp` (or `meanLogTeff0` with dust off).
- `main.ts` uses tile mode when `tiles/stars/hierarchy.json` exists and no `?stars=` parameter is given.
- New tray fields: nodes drawn, points drawn, requests in flight.
- `?debug=1` draws node boxes as hairlines.
- Hover picking (`src/stars/screen-index.ts`) works over the drawn nodes' stars.
- `?bench=1` keeps working in tile mode.

**Gate 4 (Human, on the deployed site)**:
- tile mode with `?bench=1` shows `draw ms` under 14 at 1920×1080;
- GPU memory stays flat during 2 minutes of flying (Chrome Task Manager);
- the first stars appear within 1 second.

## 9. Step 5: exploration interactions and sound

Split this into three pull requests. Follow the Spaceship style in `viewer/index.html`: hairlines, the five white opacities, orange only while something is being changed.

**5a: sound engine** (`viewer/src/sound/`):
- **Enabling**:
  - A tray toggle `♪ off` / `♪ on`, off by default. Remember the choice in localStorage, wrapped in try/catch.
  - Create the AudioContext only on the click that turns sound on.
  - Suspend it while the tab is hidden.
- **Scale**: every pitch comes from one major pentatonic scale over 3 octaves (A4 = 440 Hz; convert note numbers to Hz).
- **Hand sounds** (`hand.ts`): short band-passed noise clicks, 8–15 ms long.
  - One per 0.5-magnitude step on the magnitude knob.
  - One per decade of distance crossed on the scale rail.
  - One on pointer press.
- **Machine sounds** (`machine.ts`): FM tones (carrier + modulator, exponential decay over 120–400 ms).
  - **Hovering a newly framed star**: pitch from temperature, mapping 2,500 K → 30,000 K onto the scale's notes, low to high. Gain from apparent magnitude, from −36 dB (faint) to −12 dB (bright). Stereo position from the star's screen x.
  - **Flying to a star**: a rising two-note interval.
  - **Arriving**: a soft three-note chord.
- **Limits**: at most one hover tone per 80 ms; no hover tones while dragging the sky.

**5b: fan-out actions** (`viewer/src/hud/fan.ts`):
- **Opening**: hold for 250 ms on a framed star without moving more than 4 px. While holding, an orange ring fills; then 4 actions fan out on an arc: `fly`, `ruler`, `pin`, `info`.
- **Choosing**: the angle picks the action. For `fly`, how far you drag sets the arrival distance, log-mapped from 1 au to 10 pc. The link line shows a tick every 10%.
- **Finishing**: releasing over an action runs it. Releasing near the centre, or pressing Esc, cancels.

**5c: ruler, pins and help**:
- **Ruler** (`viewer/src/hud/ruler.ts`): after choosing `ruler` on star A, click star B. A hairline joins them, redrawn every frame. Its readout shows:
  - the distance in pc and light-years;
  - the light-travel time in years;
  - the angle between them as seen from Earth.

  Esc clears it. Check: Sun → Proxima Centauri should read about 1.30 pc and 4.24 light-years.
- **Pins** (`viewer/src/hud/pins.ts`): `pin` attaches a short note, typed into an inline input, to a star.
  - Pins are stored in localStorage (try/catch) and drawn as small markers.
  - A pin whose star is off-screen slides to the screen edge, with an arrow and the distance, like Spaceship's margin pins.
- **Help**: a `?` tray button opens a small card listing every control.

**Gate 5 (Human, on the deployed site)**:
- sound works only after it is switched on;
- the fan opens on hold, and all four actions work;
- the ruler's Proxima check passes;
- pins survive a page reload.

## 10. Reporting

After each pull request, describe in the PR:
- what you built;
- how you tested it;
- what the Human must check on the deployed site;
- anything surprising.

Do not fill in performance numbers yourself.
