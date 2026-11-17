# Measurements

Filled in while working through NEXT_STEPS.md.

## Machine

| Item | Value |
| --- | --- |
| Laptop model | |
| GPU | |
| Browser and version | |
| Window size | 1920 × 1080 |

## Step 1: Gaia slices

| Slice (G) | Rows (count) | Downloaded file | Notes |
| --- | --- | --- | --- |
| < 10 | 477,502 | gaia_Gbright-10.parquet, 36.1 MB | run 44154863537, 17 Nov 2026 |
| 10–11 | 758,820 | gaia_G10-11.parquet, 54.1 MB | |
| 11–12 | 1,825,995 | gaia_G11-12.parquet, 127.9 MB | |
| 12–12.5 | 1,693,867 | gaia_G12-12.5.parquet, 119.2 MB | |
| 12.5–13 | 2,555,346 | gaia_G12.5-13.parquet, 179.8 MB | |
| **total** | **7,311,530** | 517 MB | 1,309 rows dropped (no usable distance) |

## Step 1: star files

| File | Stars | Bailer-Jones photogeo | Bailer-Jones geo | 1/parallax | Size (MB) |
| --- | --- | --- | --- | --- | --- |
| stars-1m.bin | 1,000,001 | 997,145 | 2,855 | 0 | 14.0 |
| stars-3m.bin | 3,000,001 | 2,992,191 | 7,809 | 0 | 42.0 |
| stars-6m.bin | 6,000,001 | 5,984,205 | 15,795 | 0 | 84.0 |

## Step 1: single-file viewer (`?bench=1`)

| File | fps | draw ms | GPU memory (Chrome Task Manager) |
| --- | --- | --- | --- |
| stars-1m.bin | | ~5 | |
| stars-3m.bin | | ~10 | |
| stars-6m.bin | | ~20 | |

Straight-line fit: draw ms ≈ 1.6 + 3.0 × (millions of stars). Time grows with the
star count, so the point budget is the right lever. With about 10 ms of a 16.7 ms
frame for stars: (10 − 1.6) / 3.0 ≈ 2.8 million, so the octree's default budget of
3,000,000 stays. Machine and window size not recorded yet.

## Step 2: octree build

| Input stars | Nodes | Max depth | Total size (MB) | Build time |
| --- | --- | --- | --- | --- |
| 6,000,000 | | | | |

## Step 3: tile viewer (`?bench=1`)

| Build | fps | draw ms | Nodes drawn | Points drawn | GPU memory after 2 min | First stars after (s) |
| --- | --- | --- | --- | --- | --- | --- |
| 6 M | | | | | | |
