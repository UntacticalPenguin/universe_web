# Instructions for coding agents

Read `NEXT_STEPS.md` first, then `NEXT_STEPS_GALAXY.md` (the current tasks): they hold the task list, the specs and the gates. Do one step, or one sub-step where a step is split, per session and per pull request. Then stop and report.

## Scope

- This repository is a 3D exploration viewer of the observable universe. An idle game was planned on top of it and is **paused**: do not add game features (currencies, upgrades, tasks, accounts).
- Visual, interaction and sound design follow Spaceship IDE (https://github.com/chuanqisun/spaceship):
  - black background, white text at five opacities;
  - orange `#ff5a1f` only for what the user is changing right now;
  - JetBrains Mono, hairlines, knobs, a ruler rail, a status tray;
  - sound: clicks for the hand, FM tones for the machine, one pentatonic scale, off until the user turns it on.

## Your environment (GitHub Copilot cloud agent)

- **No GPU.** You cannot measure rendering performance; the Human measures on the deployed site. Do not invent measurements.
- **The firewall blocks the ESA Gaia archive.** Do not try to download Gaia data. Use:
  - synthetic stars generated in tests;
  - the bundled sample `viewer/public/data/stars.bin` (version 1, no temperature or dust values);
  - small synthetic version 2 files written in tests.

  Real data is downloaded and built by `.github/workflows/deploy.yml` on every push to `main`.
- **Sessions are limited to 59 minutes.** Keep each pull request to one sub-step.
- `deploy.yml` calls `python build_octree.py data/raw/*.parquet --limit 6000000 --out ../viewer/public/tiles/stars` from `pipeline/`. Keep that command line working exactly.

## Commands

```bash
# pipeline
cd pipeline && python -m pytest tests

# viewer
cd viewer && npm run build    # type-check + build; must pass
cd viewer && npm run format   # Prettier, before finishing
```

## Conventions

- **Viewer**:
  - small modules, one concern each, kebab-case file names;
  - factory functions instead of classes;
  - explicit types;
  - styles in `viewer/index.html`, using the colour tokens defined at the top of its `<style>`.
- **Pipeline**:
  - numpy and pandas, functions with docstrings;
  - reuse `prepare.py`'s helpers instead of copying them.
- **Formats**: never break the `stars.bin` version 1 or 2 formats or their loader (the bundled sample is version 1; deployed files are version 2). New formats get new names and versions.
- **Data**: never commit data files. `pipeline/data/`, `viewer/public/tiles/` and `viewer/public/data/stars-*.bin` are git-ignored.
