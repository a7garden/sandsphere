# Reproducible climate experiments

These commands run a pinned Julia primitive-equation reference model. They
are separate from the browser's TypeScript graph solver: a successful
Held–Suarez reference run cannot certify the browser dynamical core.

Install Julia 1.11, then run:

```sh
npm run science:setup
npm run science:test
npm run science:held-suarez
npm run science:rcemip
npm run science:earth
npm run science:analyze
```

Analysis uses uv with pinned Python 3.12, NumPy 2.0.2 and Matplotlib 3.9.4.
With these packages already available, `python scripts/analyze-science.py`
also works. `SANDSPHERE_JULIA` can point to a Julia
executable. The runner also recognizes the ignored local installation at
`artifacts/science/runtime/julia-1.11.9/bin/julia`. The current macOS ARM64
experiment used Julia 1.11.9 from the [official archive](https://julialang-s3.julialang.org/bin/mac/aarch64/1.11/julia-1.11.9-macaarch64.tar.gz),
SHA-256 `ed903d0d337036fc3a68414bfca5f73107af162678ef76b52e42e84e25f33bd7`,
checked against the official versions index. Project.toml and Manifest.toml
pin SpeedyWeather 0.23.0, NumericalRadiation 0.1.1 and JSON3 1.14.3.

All experiments write JSON diagnostics to `artifacts/science`; these large,
generated artifacts and the downloaded runtime are intentionally ignored.
Recorded metrics and limitations are in `docs/CLIMATE_BENCHMARK_RESULTS.md`.

## Experiments

- **Held–Suarez**: T42L20, flat surface, standard Newtonian relaxation and
  boundary-layer Rayleigh drag. Run 1,200 days; discard 200 and average 1,000
  days at 6-hour intervals. Save zonal temperature/winds, eddy heat and
  momentum flux, eddy kinetic energy, Gaussian-weighted pressure-mass drift
  and ten 100-day blocks. Published figures have no universal numeric
  pass threshold; local sanity gates are explicitly labeled.
- **Spectral SCM RCE**: SST 295/300/305 K, at least 1,000 days each, L64 pressure
  layers reaching the upper stratosphere, analytic Wing sounding and ozone,
  solar 551.58 W/m² at 42.05°, albedo 0.07, CO₂ 348 ppm, CH₄ 1,650 ppb,
  N₂O 306 ppb, zero CFC-11/CFC-12, 5 m/s surface gust speed and fixed SST. The actual time step
  is 300 seconds; radiation is computed hourly. Stationarity compares the final two 100-day means (maximum difference
  below 0.2 K). Failed columns continue in 500-day chunks, up to 2,000 days;
  failures remain failures. Checkpoints and actual integration lengths are
  recorded. Water fluxes use elapsed clock seconds.
  `column.jl` disables the T1-singular horizontal diffusion and restores
  the numerical radius scaling omitted by the reference physics-only path.
  A real-second constant-heating experiment checks that scaling.
  This is a **protocol audit**, with remaining deviations recorded, rather
  than a claim of RCEMIP ensemble agreement or official compliance.
- **Earth**: three years, first year discarded, two years averaged every
  six hours. T21L32, quadratic sigma coordinates, real orography,
  fractional land/sea, monthly prescribed SST, prognostic soil temperature,
  soil moisture and snow, prescribed monthly sea-ice area and vegetation
  climatology, and
  spectroscopic radiation. Coastal SST interpolation excludes missing land
  values and reports nearest-valid-sea fallbacks and their distances; the
  remaining 285 K placeholder applies only to fully masked land. Monthly
  means interpolate between month midpoints, and all solar/model clocks
  start together in January 2001. SST asset metadata does not establish its
  averaging period; no claim of matched boundary/observation periods is made.
  `MonthlySeaIce` uses the ERA5-derived `sea_ice.nc` concentration instead of
  SST-threshold growth/melt. Concentration drives existing ice albedo and
  heat/humidity insulation. This AMIP-style experiment does not predict ice
  area or a separate ice surface temperature. Under-ice cold temperatures
  in the supplied SST asset remain prescribed surface values.
  `julia --project=science science/earth_climate.jl` runs the T31L20 control
  with Frierson longwave instead. POWER's 24 independent locations and
  monthly 2001–2020 MERRA-2/CERES climatology test temperature, physical
  precipitation and cloud area. Supplied SST does not count as independent
  predicted temperature; the land-only error is reported separately.

## Local coupling and limits

`clouds.jl` corrects two dimensional errors in SpeedyWeather 0.23's SPEEDY
cloud diagnosis: m/s precipitation converts to mm/day with ×86,400,000,
and dry-static-energy stability is normalized by the geopotential
difference. Solid as well as liquid precipitation contributes to the
precipitating cloud diagnosis. Sampling follows the original eight-layer
physical sigma pressures (.095/.2/.34/.51/.685/.835 for free-atmosphere RH,
.835/.95 for inversion stability), independent of native layer count.
Boundary-layer cloud sits at the nearest sigma .835 level. When components
share a resolved layer, their random-union area and summed mean condensate
paths are used consistently in radiation. Installed packages are not modified.

`allsky_radiation.jl` uses ecCKD 32×32 spectral gas optics, Mie liquid and
Baum ice cloud tables, and a deterministic two-stream adding solver with
random cloud overlap. Fully masked surface states are sanitized before
spectral emission, while nonfinite active boundaries or fluxes fail the
run. Cloud fraction remains statistical and cloud water/ice paths remain
diagnostic: precipitation production ×900-s residence time, plus a
declared 0.01 kg/m² in-cloud thin stratocumulus floor. These quantities
are sensitivity assumptions, not observed or prognostically conserved
condensate. Longwave cloud scattering is neglected. ecCKD minor gases
outside the explicitly selected set retain reference-table concentrations
in Earth mode. The RCE experiment explicitly requests all eight table gases
and sets CFC-11 and CFC-12 to zero. These are material model limits.

The browser model now has eleven representative-height layers and a
uniform total-water subgrid PDF for cloud fraction and mean condensate.
Adjacent cloudy layers use maximum overlap, separated decks random overlap,
with exact weighted subcolumn radiation (at most 81 masks for eleven layers).
This established maximum-random approximation is not the IFS's more recent
exponential-random decorrelation parameterization.
Its ecCKD 32×32 gas tables are now shared with this backend, while the browser still uses diffuse solar transfer, representative heights, and different cloud/convection closures. Browser
RCE experiments can be reproduced with `npm run test:climate-rce` and
write their separate 1,000-day outputs under `artifacts/climate-reference`.

Sources: [Held & Suarez 1994](https://www.gfdl.noaa.gov/bibliography/related_files/ih9401.pdf),
[RCEMIP/Wing et al. 2018](https://gmd.copernicus.org/articles/11/793/2018/),
[RCEMIP corrigendum](https://gmd.copernicus.org/articles/11/793/2018/gmd-11-793-2018-corrigendum.pdf),
[SPEEDY Appendix A](https://users.ictp.it/~kucharsk/speedy_description/km_ver41_appendixA.pdf),
[SpeedyWeather documentation](https://speedyweather.github.io/SpeedyWeatherDocumentation/stable/),
[NumericalRadiation source](https://github.com/SpeedyWeather/NumericalRadiation.jl).


## 2026-10-11 cloud-bias follow-up

`land_flux.jl` retains published evaporation but allows dew only when the air
exceeds saturation at the actual surface temperature. A dry-soil availability
factor cannot manufacture dew in undersaturated air. `clouds.jl` no longer
excludes cold saturated clouds with an absolute 0.2 g/kg humidity cutoff.
A 210 K component-level test exercises the actual cloud diagnosis.

The production browser imports `src/sim/data/ecckd-32.json`, exported without
spectral regrouping by `export_browser_optics.jl`. Little-endian Float32 tables
retain original pressure/temperature/water grids; 64 independent original
Float64 Julia evaluations test gas optics and Planck sources, and 18 forward
layer transfers test emission direction/gradients. ECMWF data are Apache-2.0;
license and attribution accompany the exported tables.

To run actual Chromium Web Worker integrations, install playwright-core 1.64.0
under ignored `artifacts/science/runtime/browser`, start
`node scripts/science-server.mjs`, then run `node scripts/browser-science.mjs`.
The server disables filesystem refresh. Outputs include the browser version,
source SHA-256 at launch, and whether source stayed unchanged during the run.
Chrome's locally installed executable is used; no user profile is accessed.
Node and Chromium share `tests/helpers/rceExperiment.ts`. Numerical test success
is distinct from the unchanged 0.2 K / adjacent 100-day-mean stationarity gate.
Results are recorded in `docs/CLIMATE_CLOUD_BIAS_REVALIDATION.md`.


Final browser microphysics adds droplet-number-dependent Khairoutdinov–Kogan
warm autoconversion (prescribed Nc=100 cm^-3), Kessler collection, and the
WRF Lin cloud-ice-to-snow conversion, with diagnostic downward snow flux,
sublimation and sensible-heat-limited melting. Unaggregated 30-µm ice retains
Stokes sedimentation. This is neither the full six-category Lin scheme nor
a prognostic rain/snow/aerosol distribution. Fixed 10/30-µm optical radii
remain a separate declared simplification. Sources:
[GMD supplement S11](https://gmd.copernicus.org/articles/9/2031/2016/gmd-9-2031-2016-supplement.pdf),
[NCAR WRF Lin implementation](https://www2.mmm.ucar.edu/mm5/mpp/wrfbrowser/html_code/phys/module_mp_lin.F.html),
[ERF Kessler equations](https://erf.readthedocs.io/en/latest/theory/Microphysics.html).

Restart `science-server.mjs` after every physics change: disabling watch
prevents refresh but also leaves transformed modules cached. The browser
runner checks the served module for final microphysics and records its hash.
The model source must stay unchanged throughout an accepted final run.
`analyze-cloud-revalidation.py` compares preserved same-grid Earth controls
and completed Chromium/Node experiments after `npm run science:analyze`.
The 7200-step application annual soak follows the game's compressed orbit:
240 game seconds are four atmospheric physical hours, not a full Earth year.
Only the prescribed-SST column benchmarks integrate 1000 physical days.

Moist convection compensates upward and downward **dry-air mass**, rather
than equal total moist mass. Otherwise a moist rising parcel and drier
return parcel artificially accumulate dry air below as water rains out.
The entrained parcel composition/enthalpy and microphysical mixing ratios
use this dry-air basis. The pure-steam limit uses total mass instead.
`tests/dry-mass-convection.test.ts` isolates this defect; final column outputs
record every layer's initial/final dry mass. This follows the mass-coordinate
principle in [WRF Technical Note §2.3](https://www2.mmm.ucar.edu/wrf/users/docs/technote/v4_technote.pdf),
not a complete WRF or CAPE/updraft-area closure.
