# Universe Map — starter (v0.5)

**Working on this repo? Start with [AGENTS.md](AGENTS.md) and [NEXT_STEPS.md](NEXT_STEPS.md).** Current focus: exploration only; the idle game is paused. Next for the agent: G1 in [NEXT_STEPS_GALAXY.md](NEXT_STEPS_GALAXY.md).

A minimal, working first version: Gaia stars → binary file → 3D viewer in the browser.
Everything later (octree, streaming, galaxies, nebulae) grows out of these two folders.

```
pipeline/   Python: download and prepare data (runs on your computer)
viewer/     TypeScript + three.js: the website (runs in the visitor's browser)
.github/    automatic deploy of viewer/ to GitHub Pages
```

## 1. Install (once)

| Tool | Get it | Check |
|---|---|---|
| Python 3.11+ | python.org (Windows: tick "Add to PATH") | `python --version` |
| Node.js 20+ (LTS) | nodejs.org | `node --version` |
| Git | git-scm.com | `git --version` |
| VS Code | code.visualstudio.com, plus the Python extension | |

## 2. Pipeline

Windows (PowerShell):
```powershell
cd pipeline
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m pytest tests
```
macOS / Linux: same, but activate with `source .venv/bin/activate`.

Download bright stars (needs internet; the archive job can take a few minutes):
```
python fetch_gaia.py --gmax 10
```
Turn them into the viewer file:
```
python prepare.py data/raw/gaia_Gbright-10.parquet
```
This writes `viewer/public/data/stars.bin` and a `stars.json` summary
(how many stars, which distance method was used for how many).

`--limit N` keeps only the N brightest stars (used for the 1 M / 3 M / 6 M test files).
`fetch_gaia.py --count` prints a slice's row count without downloading it.

Old CSVs from the previous project also work: `python prepare.py path/to/gaia.csv`.
They have no `parallax_error`, so unreliable distances can't be filtered out; prefer fresh downloads.

## 3. Viewer

```
cd viewer
npm install
npm run dev
```
Open the address it prints (usually http://localhost:5173). Edit files in `viewer/src/`
and the page reloads by itself.

Controls:

| Do | Effect |
|---|---|
| drag on the sky | orbit around the target |
| right-drag | pan |
| wheel | zoom (multiplies the distance, so it feels even at every scale) |
| hover a star | brackets + readout: distance from the Sun, absolute and apparent magnitude, temperature, type |
| click a star | fly to it; it becomes the orbit target |
| drag along the left rail | set the camera's distance to the target directly, 200 au to 14 Gpc |
| drag / scroll / arrow keys on a knob in the tray | magnitude limit, exposure; double click resets |
| `⌂ sun` | back to the Sun |

The frame counter reads `idle` when nothing changes: the viewer only draws when the view changes.

URL parameters: `?stars=stars-3m.bin` loads another file from `public/data/`; `?bench=1` orbits continuously and shows `draw ms`, the median time to draw a frame including GPU work.

Look and feel follow [Spaceship IDE](https://github.com/chuanqisun/spaceship) by Chuanqi Sun (MIT):
black, white ink in five steps, orange only for what is changing right now, JetBrains Mono, hairlines,
a crosshair pointer with corner brackets, a ruler rail, small knobs and a status tray.
So does the code organisation (see its AGENTS.md): one module per concern, factory functions, no classes.

## 4. Put it online (GitHub Pages, free)

1. Create a repository on github.com and put these files in it.
2. On GitHub: Settings → Pages → Source: **GitHub Actions**.
3. Every push to `main` now runs `.github/workflows/deploy.yml`. It downloads Gaia slices (cached between runs), builds `stars.bin` plus the 1 M / 3 M / 6 M test files (and octree tiles once `pipeline/build_octree.py` exists), builds `viewer/` and publishes it.
4. Required for real data: add the repository secrets `GAIA_USER` and `GAIA_PASSWORD` (your ESA Gaia archive login). Since October 2026, anonymous archive queries stop after 1 minute and 50,000 rows.

For GitHub Copilot's cloud agent, `.github/workflows/copilot-setup-steps.yml` prepares its environment and `AGENTS.md` tells it how to work here.

Limits to keep in mind: a single file in a GitHub repo can't exceed 100 MB, and a Pages site
can't exceed 1 GB. `stars.bin` costs 14 bytes per star (version 1) or 17 (version 2, with temperature and dust), so about 6–7 million stars per file.
Beyond that, the octree tiles move to Cloudflare R2.

## Files

| File | What it does |
|---|---|
| `pipeline/fetch_gaia.py` | ADQL query: Gaia DR3 joined with Bailer-Jones distances, one magnitude slice per run |
| `pipeline/prepare.py` | Picks the best distance, converts (l, b, d) → (x, y, z) pc, absolute magnitude, writes `stars.bin` (format documented at the top) |
| `pipeline/tests/test_prepare.py` | Checks coordinates against astropy, the distance choice, and the binary layout |
| `viewer/index.html` | Page markup and all styles (design tokens at the top) |
| `viewer/src/main.ts` | Composition: renderer, camera, controls, wiring between modules, draw-on-change loop |
| `viewer/src/stars/load-stars.ts` | Reads `stars.bin` into typed arrays |
| `viewer/src/stars/colour-lut.ts` | bp_rp → temperature → blackbody → RGB lookup table |
| `viewer/src/stars/stars-layer.ts` | Point shader: brightness from m = M + 5 log10(d / 10 pc) at the camera |
| `viewer/src/stars/screen-index.ts` | Projects visible stars into a screen grid once the view is still, for instant hover picking |
| `viewer/src/view/flight.ts` | Eased flight to a new target, and setting the camera's distance |
| `viewer/src/hud/pointer.ts` | Crosshair, brackets, readout, click-to-select |
| `viewer/src/hud/scale-rail.ts` | Logarithmic distance ruler with per-decade star meters and landmarks |
| `viewer/src/hud/knob.ts`, `tray.ts`, `target-mark.ts` | Tray knobs, tray readings, the target ring |

Run `npm run format` (Prettier) before committing.

## Next milestones

1. ✅ Binary star file + viewer
2. ✅ Spaceship-style interface, draw-on-change, screen-space picking
3. ✅ Real Gaia data (7.3 M stars, G < 13) with temperature and dust; draw time measured
4. Light and colour: HDR, tone mapping, automatic exposure, dust switch, glow (NEXT_STEPS Step 2)
5. Octree builder in `pipeline/` + tile streaming in `viewer/src/lod/`, with aggregated light per node (Steps 3–4)
6. Exploration interactions and sound (Step 5)
7. Labels and annotations
8. Galaxies (2MRS first), then a 3D dust map and nebulae
