"""
Step 1 of the pipeline: download Gaia stars + Bailer-Jones distances.

Usage (from the pipeline folder, with the virtual environment active):
    python fetch_gaia.py --gmax 10              # all stars brighter than G = 10
    python fetch_gaia.py --gmin 10 --gmax 11    # the next magnitude slice
    python fetch_gaia.py --gmax 10 --login      # log in to your ESA account first

    python fetch_gaia.py --gmin 11 --gmax 12 --count   # only print how many rows a slice has

If the environment variables GAIA_USER and GAIA_PASSWORD are set (for example as GitHub
Actions secrets), the script logs in with them, without a prompt.

Output: data/raw/gaia_G<gmin>-<gmax>.parquet

Limits of the ESA archive (since its October 2026 release, see
https://www.cosmos.esa.int/web/gaia-users/archive/collaborate#GaiaArchiveUserQuotas):

    anonymous:  asynchronous jobs time out after 1 minute and return at most 50,000 rows
    logged in:  asynchronous jobs time out after 120 minutes, no row limit, 20 GB of results

The join with the distance table takes far longer than a minute, so this script needs an
account: register at https://www.cosmos.esa.int/web/gaia-users/register.

Why magnitude slices: each slice is one archive job. Bright stars are few,
faint stars are many, so going one magnitude at a time keeps every job a
manageable size. Start with --gmax 10 and only go fainter once the viewer works.
"""
import argparse
import os
from pathlib import Path

from astroquery.gaia import Gaia

# Gaia DR3 and EDR3 share the same source_id values, so the Bailer-Jones
# distance table (computed for EDR3) joins directly onto DR3.
QUERY = """
SELECT g.source_id, g.l, g.b,
       g.parallax, g.parallax_error, g.ruwe,
       g.phot_g_mean_mag, g.bp_rp,
       d.r_med_geo, d.r_med_photogeo, d.r_lo_photogeo, d.r_hi_photogeo
FROM gaiadr3.gaia_source AS g
JOIN external.gaiaedr3_distance AS d ON g.source_id = d.source_id
WHERE g.phot_g_mean_mag >= {gmin} AND g.phot_g_mean_mag < {gmax}
"""

COUNT_QUERY = """
SELECT COUNT(*) AS n
FROM gaiadr3.gaia_source AS g
JOIN external.gaiaedr3_distance AS d ON g.source_id = d.source_id
WHERE g.phot_g_mean_mag >= {gmin} AND g.phot_g_mean_mag < {gmax}
"""

ANONYMOUS_ROW_CAP = 50_000


def main() -> None:
    ap = argparse.ArgumentParser(description="Download a magnitude slice of Gaia DR3 with distances.")
    ap.add_argument("--gmin", type=float, default=-5.0, help="faint end is exclusive; bright end inclusive")
    ap.add_argument("--gmax", type=float, required=True)
    ap.add_argument("--login", action="store_true", help="prompt for your ESA Gaia archive login first")
    ap.add_argument("--out", type=Path, default=Path("data/raw"))
    ap.add_argument("--count", action="store_true", help="only print the number of rows in this slice")
    args = ap.parse_args()

    # Credentials from the environment (GitHub Actions secrets GAIA_USER / GAIA_PASSWORD) log in without a prompt.
    user, password = os.environ.get("GAIA_USER"), os.environ.get("GAIA_PASSWORD")
    logged_in = False
    if args.login:
        Gaia.login()  # asks for username and password in the terminal
        logged_in = True
    elif user and password:
        Gaia.login(user=user, password=password)
        logged_in = True
    else:
        print("WARNING: not logged in. Anonymous archive jobs stop after 1 minute and 50,000 rows, "
              "which this query exceeds. Use --login, or set GAIA_USER and GAIA_PASSWORD.")

    Gaia.ROW_LIMIT = -1  # no client-side row cap
    if args.count:
        job = Gaia.launch_job_async(COUNT_QUERY.format(gmin=args.gmin, gmax=args.gmax))
        n = int(job.get_results()["n"][0])
        print(f"G {args.gmin:g} to {args.gmax:g}: {n:,} rows")
        if n > ANONYMOUS_ROW_CAP and not logged_in:
            print("More than 50,000 rows: anonymous downloads would be cut off. Log in.")
        return

    query = QUERY.format(gmin=args.gmin, gmax=args.gmax)
    print("Submitting query:\n" + query)
    job = Gaia.launch_job_async(query)
    table = job.get_results()
    print(f"Received {len(table):,} rows")
    if len(table) == ANONYMOUS_ROW_CAP and not logged_in:
        raise SystemExit("ERROR: exactly 50,000 rows, the anonymous limit, so the result was cut off. "
                         "Log in (--login, or GAIA_USER and GAIA_PASSWORD) and run again.")

    args.out.mkdir(parents=True, exist_ok=True)
    gmin = "bright" if args.gmin <= -5 else f"{args.gmin:g}"
    path = args.out / f"gaia_G{gmin}-{args.gmax:g}.parquet"
    table.to_pandas().to_parquet(path, index=False)
    print(f"Saved {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
