"""Fetch NASA POWER 2001–2020 monthly climatologies; at most 5 requests.

Run: python3 scripts/fetch-climate-reference.py
No credentials. A failed or incomplete download never replaces the fixture.
"""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

PARAMETERS = {
    "T2M": "C", "TS": "C", "RH2M": "%", "PS": "kPa",
    "PRECTOTCORR": "mm/day", "CLOUD_AMT": "%",
    "ALLSKY_SFC_SW_DWN": "kW-hr/m^2/day",
    "CLRSKY_SFC_LW_DWN": "kW-hr/m^2/day", "ALLSKY_SFC_LW_DWN": "kW-hr/m^2/day",
}
MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()
POINTS = [(lat, lon) for lat in [-75, -45, -15, 15, 45, 75] for lon in [-135, -45, 45, 135]]

def fetch(point):
    lat, lon = point
    url = "https://power.larc.nasa.gov/api/temporal/climatology/point?" + urllib.parse.urlencode({
        "parameters": ",".join(PARAMETERS), "community": "RE", "latitude": lat,
        "longitude": lon, "format": "JSON", "start": 2001, "end": 2020,
    })
    with urllib.request.urlopen(url, timeout=60) as response:
        raw = response.read()
    data = json.loads(raw)
    values = data["properties"]["parameter"]
    for key, unit in PARAMETERS.items():
        if data["parameters"][key]["units"] != unit:
            raise ValueError((key, data["parameters"][key]))
        if any(values[key][month] == data["header"]["fill_value"] for month in MONTHS):
            raise ValueError((point, key, "missing data"))
    return {"latitude": lat, "longitude": lon, "url": url,
            "sha256": hashlib.sha256(raw).hexdigest(), "header": data["header"],
            "values": {key: [values[key][month] for month in MONTHS] for key in PARAMETERS}}

if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        points = list(pool.map(fetch, POINTS))
    result = {"schema": 1, "retrievedUTC": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "period": [2001, 2020], "units": PARAMETERS, "months": MONTHS, "points": points,
              "sampling": "24 grid points; equal longitude spacing, 30-degree latitude bands; not a full global grid",
              "sources": {"meteorology": "MERRA-2 reanalysis (not direct station observations)",
                          "cloud": "CERES SYN1deg satellite-derived cloud amount",
                          "radiativeFluxes": "CERES SYN1deg radiative-transfer retrievals"}}
    path = Path(__file__).resolve().parents[1] / "tests/fixtures/nasa-power-climatology.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)
    print(f"Saved {len(points)} points × 12 months: {path}")
