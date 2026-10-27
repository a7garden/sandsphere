# Independent pre-optimization atmosphere oracle

This directory contains the complete historical simulation import graph:
33 TypeScript modules and the spectral table JSON, copied from the verified
2026-10-23 reference checkout. `manifest.json` pins their original bytes to
`docs/performance/2026-10-23/source-baseline.json`. The five original `frozen`
entries and all original `shared` hashes are unchanged. `additionalShared`
records the previously omitted transitive chemistry dependency against that
same source receipt. No source hash or historical golden was refreshed.

The source receipt describes a working tree with uncommitted and untracked
files. Its `baselineHead` alone cannot reconstruct that tree. Every copied
file was verified against the receipt before inclusion; these fixtures must
not be regenerated from current production code.

Each TypeScript file has only the existing two-line fixture header added.
The test strips that header and checks the original SHA-256; the JSON is
checked byte for byte. All original relative imports resolve inside this
directory, including geometry, thermodynamics, phase equilibrium, gases,
radiative transfer, chemistry and the spectral data. An import-graph test
checks every static import and re-export, all transitive dependencies and
complete manifest reachability. External imports, dynamic imports and
`import.meta` are rejected. The historical graph never returns to production
modules through a shared helper.

The `@ts-nocheck` header keeps historical declarations intact; it changes no
executed arithmetic. The old implementation retains its original allocations,
repeated donor calculations and scalar spectral loop. It never calls the
current optimized spectral module or SIMD kernel.

Every platform executes historical and current warm/cold scenarios
independently and compares initialization, both diagnostic columns, every
transport/radiation stage, every checkpoint field, surface and exchange array
with `Object.is`. Historical geometry and radiative transfer also come from
the frozen graph. Deep transport additionally compares every repeated stage
against the historical implementation from the same initial checkpoint.
Signed zero and one-bit Float64 differences fail. No epsilon or expected
values were changed for the intentional physics fixes.

The original warm/cold SHA-256 captures remain additional guards in their
recorded environment: Darwin ARM64, Node v24.20.0, V8 13.6.233.17-node.53.
ECMAScript transcendental `Math` operations can produce different final low
bits in other runtime/build environments, so that receipt is not a universal
numeric oracle. All platforms still execute the independent exact comparisons.

These scenarios cover the historical transport and radiation behavior they
exercise. Intentional new physics is verified separately against physical
invariants and analytical expectations; agreement here does not validate
pure-steam coexistence, subkelvin escape or all evolved states. Future
intentional changes to a compared scenario need an explicit new oracle and
scope, preserving this historical receipt rather than refreshing its hashes.

For a runtime diagnostic receipt, without a performance measurement:

```sh
PHYSICS_ORACLE_DIAGNOSTICS=1 npx vitest run tests/physics-performance-equivalence.test.ts --maxWorkers=1 --disableConsoleIntercept
```
