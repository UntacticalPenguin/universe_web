"""Inspect a published Gaia release before changing any production table bindings."""
import os
from pathlib import Path
import re


def inspect(archive, release="gaiadr4"):
    """Discover published tables and columns, then count unjoined G<15 sources."""
    if not re.fullmatch(r"gaiadr[0-9]+", release):
        raise ValueError("invalid Gaia release schema")

    def execute(query):
        job=archive.launch_job_async(query)
        try:
            frame=job.get_results().to_pandas()
            frame.columns=frame.columns.str.lower()
            return frame
        finally:
            archive.remove_jobs([job.jobid])

    tables=execute("SELECT table_name FROM TAP_SCHEMA.tables "
                   f"WHERE schema_name='{release}' OR table_name LIKE '%distance%' "
                   f"OR table_name LIKE '%{release}%neighbour%'")
    names=sorted(tables.table_name.astype(str))
    if not any(name.lower().startswith(release+".") for name in names):
        raise RuntimeError(f"No published {release} tables visible")
    source=next((name for name in names if name.lower()==release+".gaia_source"),None)
    report=["## Gaia release inspection", "", "Available distance and crossmatch candidates", "",
            *[f"- `{name}`" for name in names if re.search("distance|neighbour",name,re.I)]]
    if source is None:
        report+=["", "Choose the source table from the published release tables:", *names]
        return "\n".join(report)
    columns=execute(f"SELECT column_name FROM TAP_SCHEMA.columns WHERE table_name='{source}'")
    names=sorted(columns.column_name.astype(str))
    report+=["",f"Columns of `{source}`", "", ", ".join(names)]
    if "phot_g_mean_mag" in [name.lower() for name in names]:
        rows=execute(f"SELECT COUNT(*) AS n FROM {source} WHERE phot_g_mean_mag < 15")
        report+=["", f"G < 15 before joining distances: {int(rows.iloc[0,0]):,} sources."]
    return "\n".join(report)


if __name__=="__main__":
    from astroquery.gaia import Gaia
    Gaia.login(user=os.environ["GAIA_USER"],password=os.environ["GAIA_PASSWORD"])
    try:
        summary=inspect(Gaia)
        print(summary)
        if path:=os.getenv("GITHUB_STEP_SUMMARY"):
            with Path(path).open("a") as output:
                print(summary,file=output)
    finally:
        Gaia.logout()
