# Independent pre-optimization atmosphere oracle

These five modules are frozen copies from the verified 2026-10-23 reference
checkout. `manifest.json` pins their original bytes to
`docs/performance/2026-10-23/source-baseline.json` and its baseline commit. They
must not be regenerated from current production code.

Only relative import paths and the two-line fixture header differ. The test
reverses that mechanical relocation and checks each original SHA-256. The
`@ts-nocheck` header keeps this historical code independent of evolving nominal
production TypeScript class declarations; it changes no executed arithmetic.

Layered atmosphere, spectral interpolation/source construction, model setup
and surface preparation are independently frozen. The old implementation
retains its original allocations, repeated donor calculations and scalar
spectral loop; it never calls the current optimized spectral module or SIMD
kernel. Shared low-level physical helpers, radiative transfer, geometry and
table data are separately pinned to their unchanged pre-optimization hashes.
The test fails if either a frozen body or any shared dependency changes. Future
intentional physics changes need an explicit new oracle, not hash refreshes.

Every platform executes the original and optimized scenarios independently and
compares initialization, both diagnostic columns, every transport/radiation
stage, every checkpoint field, surface and exchange array with `Object.is`.
Signed zero and one-bit Float64 differences fail. This is neither a tolerance
test nor a current-implementation self-comparison.

The original warm/cold SHA-256 captures remain additional guards in their
recorded environment: Darwin ARM64, Node v24.20.0, V8 13.6.233.17-node.53.
ECMAScript transcendental `Math` operations can produce different final low
bits in other runtime/build environments, so that receipt is not a universal
numeric oracle. All platforms, including Linux, still run the stronger
independent original-vs-optimized exact comparisons.

For a runtime diagnostic receipt, without a performance measurement:

```sh
PHYSICS_ORACLE_DIAGNOSTICS=1 npx vitest run tests/physics-performance-equivalence.test.ts --maxWorkers=1 --disableConsoleIntercept
```
