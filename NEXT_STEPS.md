# Universe Map: next steps

Brief for a coding agent (GitHub Copilot cloud agent or any other) working in this repository. Read `AGENTS.md` first.

- Work through the steps in order.
- Do one sub-step per session and per pull request.
- Stop at each gate and report.
- A human (the project owner, "Human") does everything marked **Human**: settings, secrets and all performance measurements.

## 1. Context

Universe Map is a browser-based 3D map of the observable universe built from real catalogs. Current focus: **exploration only**, with the Spaceship-style interface and sound. The idle-game layer is paused.

```
pipeline/   Python: download catalog data and turn it into compact binary files
viewer/     TypeScript + three.js (Vite): the website
.github/    deploy.yml builds real data + the site; copilot-setup-steps.yml prepares the agent's environment
docs/       measurements.md, filled in by the Human
```

Current state, v0.4:

- `pipeline/fetch_gaia.py` downloads Gaia DR3 stars joined with Bailer-Jones distances, one magnitude slice per run.
  - `--count` prints a slice's row count without downloading it.
  - It logs in automatically when the environment variables `GAIA_USER` and `GAIA_PASSWORD` are set.
- `pipeline/prepare.py` writes `stars.bin` (format documented at the top of the script): 14 bytes per star. `--limit N` keeps only the N brightest stars.
- The viewer loads one star file and draws every star in one draw call.
  - Brightness follows the apparent magnitude seen from the camera.
  - Colour comes from a blackbody lookup table.
  - It only redraws when the view changes.
  - Hovering a star frames it with brackets and a readout; clicking flies to it.
  - The left rail is a logarithmic distance ruler; the tray at the bottom has knobs for magnitude limit and exposure.
- URL parameters:
  - `?stars=<file>.bin` loads another file from `viewer/public/data/`.
  - `?bench=1` orbits continuously and shows `draw ms`, the median time to draw a frame including GPU work.
- `.github/workflows/deploy.yml` runs on every push to `main`. It downloads Gaia slices (cached between runs) and builds `stars.bin` (1 M stars) plus `stars-1m.bin`, `stars-3m.bin` and `stars-6m.bin`. Once `pipeline/build_octree.py` exists, it also builds `tiles/stars/`. Then it publishes everything to GitHub Pages.

The single star file does not scale. Steps 2 and 3 replace it with an octree of tiles that the viewer streams. Step 4 adds the exploration interactions and sound.

## 2. Ground rules

- Order: Step 1 (Human only), then 2, 3 and 4. Do not start other roadmap items: HDR rendering, background shells, nebulae, galaxies or any game feature.
- After every change:
  - `cd pipeline && python -m pytest tests`;
  - `cd viewer && npm run build`.

  Both must pass. Run `npm run format` before finishing.
- Never break the `stars.bin` v1 format or its loader. New formats get new names and versions.
- Code style: see `AGENTS.md`.
- Never commit data files. Never download Gaia data in an agent session: the agent's firewall blocks the archive, and real data comes from `deploy.yml`.
- Test with synthetic data and with the bundled sample `viewer/public/data/stars.bin` (about 146,000 stars).
- Never report performance numbers you did not measure. Performance gates are measured by the Human on the deployed site.

## 3. Where the data comes from

| Source | Address | Used for | Access |
| --- | --- | --- | --- |
| ESA Gaia Archive (ADQL) | https://gea.esac.esa.int/archive/ | `gaiadr3.gaia_source` joined with `external.gaiaedr3_distance` | `fetch_gaia.py`, run by `deploy.yml` on GitHub Actions |
| Gaia archive account | https://www.cosmos.esa.int/web/gaia-users/register | Required: anonymous queries are too limited for this data | **Human** registers, then adds the repository secrets `GAIA_USER` and `GAIA_PASSWORD` |
| Bailer-Jones distances | https://bailer-jones.www3.mpia.de/gedr3_distances.html | Explains the distance columns | Already joined in the query |
| ESA bulk files | https://cdn.gea.esac.esa.int/Gaia/gdr3/ | Later only (full catalog) | Not now |
| LIneA HATS Parquet copy | https://data.linea.org.br/en/lsdb/gaia_dr3.html | Later only | Not now |

Archive limits since the archive's October 2026 release ([user quotas](https://www.cosmos.esa.int/web/gaia-users/archive/collaborate#GaiaArchiveUserQuotas)): without an account, asynchronous jobs stop after **1 minute** and **50,000 rows**, too little for these queries. With an account: a 120-minute timeout, no row limit and 20 GB of stored results. `deploy.yml` skips the download with a warning when the secrets are missing. The archive is closed from 25 November 2026, 12:00 CET, until the Gaia DR4 release on 2 December 2026.

## 4. Step 1: real data online and measured (Human)

1. **Human**: Settings → Pages → Source: **GitHub Actions**.
2. **Human**, required: register a Gaia archive account (https://www.cosmos.esa.int/web/gaia-users/register) and add the repository secrets `GAIA_USER` and `GAIA_PASSWORD` (Settings → Secrets and variables → Actions). Without them no data can be downloaded.
3. **Human**: Actions → "Build data and deploy to GitHub Pages" → Run workflow.
   - The first run downloads data and can take a while.
   - The run summary lists each star file's count and distance sources.
4. **Human**: open each of the following and read `fps` and `draw ms` from the tray after 10 seconds:
   - `https://<user>.github.io/<repo>/?bench=1&stars=stars-1m.bin`
   - `https://<user>.github.io/<repo>/?bench=1&stars=stars-3m.bin`
   - `https://<user>.github.io/<repo>/?bench=1&stars=stars-6m.bin`

   Record the numbers in `docs/measurements.md`, with the device, GPU and browser.

**Gate 1**: the site shows real Gaia stars, and the 6 M baseline is recorded.

## 5. Step 2: octree tiles (pipeline)

Write `pipeline/build_octree.py` and `pipeline/tests/test_octree.py` in one pull request. Test only with synthetic stars and the sample data.

### 5.1 Algorithm

1. Load the Parquet or CSV inputs exactly as `prepare.py` does, reusing its helpers: x, y, z (pc, float64, heliocentric galactic), absolute magnitude M, `bp_rp`. Support `--limit N` the same way.
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
   - `meanBpRp`: luminosity-weighted mean `bp_rp`;
   - `mMin`: the brightest M in the subtree.

### 5.2 Output (`--out`, normally `viewer/public/tiles/stars/`)

**One `<id>.bin` per node.** Ids are octant paths: `r`, then `r0`…`r7`, then `r05`, and so on. Little-endian, version 1:

```
bytes 0-3     magic "STN1"
bytes 4-7     uint32 version (1)
bytes 8-11    uint32 count
bytes 12-15   uint32 reserved (0)
then          count × 3 int16   position relative to the node centre: round(offset / half × 32767)
then          count × uint8     absolute magnitude, quantised like prepare.py (M from −10 to 20)
then          count × uint8     colour, quantised like prepare.py (bp_rp from −0.5 to 4.5)
```

The file size is exactly 16 + 8 × count bytes.

**One `hierarchy.json`:**

```json
{
  "version": 1, "format": "STN1", "capacity": 32768,
  "absmagRange": [-10, 20], "colourRange": [-0.5, 4.5], "root": "r",
  "nodes": {
    "r": { "center": [0, 0, 0], "half": 16384, "count": 32768, "subtreeCount": 6000001,
           "mMin": -9.1, "lSum": 1.2e9, "centroid": [12.3, -4.5, 1.2], "meanBpRp": 1.1,
           "children": ["r0", "r1", "r4"] }
  }
}
```

The numbers above are placeholders. Keep `center` and `centroid` at full float64 precision. The script prints node count, maximum depth, total bytes and build time.

### 5.3 Tests (about 20,000 synthetic stars)

1. Every input star is stored in exactly one node.
2. Every stored star lies inside its node's cube.
3. Brighter stars sit higher in the tree: the faintest star stored in a parent is no fainter than the brightest star in any of its children.
4. A node's `lSum` equals its stored stars' luminosity plus its children's `lSum` (relative tolerance 1e-9).
5. Decoding a tile reproduces positions within half × √3 / 32767.
6. Every tile file is 16 + 8 × count bytes and starts with `STN1`.

The command `python build_octree.py data/raw/*.parquet --limit 6000000 --out ../viewer/public/tiles/stars` must work as written, because `deploy.yml` calls it.

**Gate 2**: tests pass. After merging, the deploy run builds tiles; the Human checks the run summary.

## 6. Step 3: stream tiles in the viewer

Split this into three pull requests, in order.

**3a: selection, with unit tests.** Create `viewer/src/lod/hierarchy.ts` and `viewer/src/lod/select-nodes.ts`, and add vitest as a dev dependency with an `npm test` script. `select-nodes.ts` is a pure function. Given the hierarchy, camera, viewport, magnitude limit and point budget, it returns:
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

**3b: loading.** Create these modules:
- `decode-worker.ts`: a Web Worker that fetches a tile, checks its header and returns the typed arrays as transferables;
- `tile-loader.ts`: a priority queue with at most 6 requests in flight; AbortController cancels requests for nodes no longer wanted;
- `tile-cache.ts`: an LRU cache with a 256 MB budget that disposes GPU buffers on eviction.

**3c: drawing and wiring.**
- `node-points.ts`: one `THREE.Points` per loaded node, drawn relative to the camera:
  - every frame, compute `offset = node.center − camera.position` in JavaScript (float64);
  - pass `offset` and `half` as uniforms;
  - the vertex shader computes `p = uOffset + aPos × uHalf` (`aPos` a normalised int16 attribute) and applies the camera's rotation only;
  - brightness and size reuse the constants in `src/stars/stars-layer.ts`.
- `glow-layer.ts`: one soft point per unrefined node at its `centroid`, brightness from `lSum`, colour from `meanBpRp`.
- `main.ts` uses tile mode when `tiles/stars/hierarchy.json` exists and no `?stars=` parameter is given.
- New tray fields: nodes drawn, points drawn, requests in flight.
- `?debug=1` draws node boxes as hairlines.
- Hover picking (`src/stars/screen-index.ts`) works over the drawn nodes' stars.
- `?bench=1` keeps working in tile mode.

**Gate 3 (Human, on the deployed site)**:
- tile mode with `?bench=1` shows `draw ms` under 14 at 1920×1080;
- GPU memory stays flat during 2 minutes of flying (Chrome Task Manager);
- the first stars appear within 1 second.

## 7. Step 4: exploration interactions and sound

Split this into three pull requests. Follow the Spaceship style in `viewer/index.html`: hairlines, the five white opacities, orange only while something is being changed.

**4a: sound engine** (`viewer/src/sound/`):
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

**4b: fan-out actions** (`viewer/src/hud/fan.ts`):
- **Opening**: hold for 250 ms on a framed star without moving more than 4 px. While holding, an orange ring fills; then 4 actions fan out on an arc: `fly`, `ruler`, `pin`, `info`.
- **Choosing**: the angle picks the action. For `fly`, how far you drag sets the arrival distance, log-mapped from 1 au to 10 pc. The link line shows a tick every 10%.
- **Finishing**: releasing over an action runs it. Releasing near the centre, or pressing Esc, cancels.

**4c: ruler, pins and help**:
- **Ruler** (`viewer/src/hud/ruler.ts`): after choosing `ruler` on star A, click star B. A hairline joins them, redrawn every frame. Its readout shows:
  - the distance in pc and light-years;
  - the light-travel time in years;
  - the angle between them as seen from Earth.

  Esc clears it. Check: Sun → Proxima Centauri should read about 1.30 pc and 4.24 light-years.
- **Pins** (`viewer/src/hud/pins.ts`): `pin` attaches a short note, typed into an inline input, to a star.
  - Pins are stored in localStorage (try/catch) and drawn as small markers.
  - A pin whose star is off-screen slides to the screen edge, with an arrow and the distance, like Spaceship's margin pins.
- **Help**: a `?` tray button opens a small card listing every control.

**Gate 4 (Human, on the deployed site)**:
- sound works only after it is switched on;
- the fan opens on hold, and all four actions work;
- the ruler's Proxima check passes;
- pins survive a page reload.

## 8. Reporting

After each pull request, describe in the PR:
- what you built;
- how you tested it;
- what the Human must check on the deployed site;
- anything surprising.

Do not fill in performance numbers yourself.
