# Float64 spectral acceleration

The checked-in `src/sim/data/spectral-optics-simd.wasm` is a strict Float64 SIMD
interpolation kernel for the ecCKD gas tables already attributed in
`src/sim/data/NOTICE`. Public spectral results retain caller-owned arrays. The
ordinary JavaScript implementation remains the exact reference and fallback.

The kernel processes independent adjacent bands in f64x2 lanes. Every gas
accumulates in j=0..7 order; no cross-lane reductions, FP32, relaxed SIMD, FMA,
reassociation, source approximations or cache policy changes are involved.

`initializeSpectralAcceleration()` performs best-effort initialization outside
physics advance, capped at three seconds, and checks representative warm,
cold, trace, absent, zero and signed-zero cases against JavaScript using
`Object.is`. Unsupported SIMD, offline loading, CSP rejection, initialization
failure and runtime traps keep or restore JavaScript. A timeout/disable cannot
publish a late kernel. A reentrant diagnostic call uses JavaScript to preserve
the active output. Backend remains CPU; optional status/counters separately
identify the accelerator.

One initialized instance lives in each module realm, shared by its serial
solver calls. It adds 3,256,576 bytes of table copies (3.11 MiB) and currently
3,342,336 bytes of total WASM linear memory (3.19 MiB). Main and physics-worker
realms each own their instance; this is not allocated per planet. The existing
JavaScript tables are retained for fallback. Growth occurs once before typed
views are created. No shared memory or cross-origin isolation is required.

The prebuilt asset and manifest are sufficient for `npm run build`; LLVM is
not a build/install dependency. Vite owns release URL/inline packaging for the
small imported asset. To reproduce it using existing local tools only:

```sh
node scripts/build-spectral-wasm.mjs
```

Optional `SPECTRAL_WASM_CLANG` and `SPECTRAL_WASM_LD` select local compiler/linker
paths. Otherwise the script uses clang and an installed Rust toolchain's
rust-lld, with a scoped libLLVM lookup path on macOS. It never downloads tools.
The manifest records source/binary hashes, exact flags and compiler versions.
`-ffp-contract=off` and `-fno-fast-math` are required. A different object basename
may change custom WASM name sections while leaving code/data sections identical;
verify both the new binary hash and exactness tests after rebuilding.

Focused checks:

```sh
npx vitest run tests/spectral-acceleration.test.ts tests/physics-performance-equivalence.test.ts tests/spectral-radiation.test.ts tests/atmosphere-exchange18.test.ts tests/worker-solver.test.ts --maxWorkers=1
```

The isolated research harness and measurements are retained separately under
`artifacts/performance-optimization-20261023/wasm-experiment`. The production
adapter uses the measured one-layer seam; there is no eleven-layer batching
restructure. Complete application/browser acceptance is a separate gate from
kernel or Node measurements.
