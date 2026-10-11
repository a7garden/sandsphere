# Material supply and land animal movement

These behaviors are included in `0.6.0`.

## Surface supply

The surface brush adds each cell's weighted share to the next solver command batch immediately. It retains the brush footprint, material inventory rules, and total supplied mass. Paused edits can commit with a zero-duration step.

Supply feedback uses the existing terrain and water shaders. Each supplied cell gets a material-colored interior tint and a short emissive polygon boundary; the fan's inner spokes are not outlined. The pulse fades over 0.24 display seconds, including during simulation pause. One texel per physical cell stores its latest color/intensity and emission time, so repeated strokes replace effects rather than accumulating particles. Dirty strokes share one texture upload per display frame; fading changes only shader time and uploads no cell buffers. Idle shading skips the pulse texture sample. A 2,562-cell world uses a 41,984-byte reusable effect texture and static vertex coordinates. The effect adds no meshes or draw calls, holds no physical mass, and is excluded from saves. Nonhexagonal styles retain the interior tint without polygon borders.

Picks in open air use the same immediate brush delivery at the selected surface cells. They do not create airborne material, wait for gravity, or accumulate physical dust during paused strokes. Gas delivery continues to use the atmosphere command fields. The legacy falling-parcel solver remains available to physical test fixtures; the application brush does not call it.

## Land animal movement

The simulation stores herbivore and predator biomass per cell, rather than a list of individual animals. Each guild shares a multi-source Dijkstra navigation field. This avoids a separate path search for each displayed animal.

- Herbivores seek accessible vegetation. Path costs include travel distance, slope, competition, and predator risk.
- Predators seek accessible herbivore biomass. Travel distance, slope, and competing predators affect the chosen destination.
- Open surface water and molten ground block incoming movement. Soil-retained moisture permits land travel. Temperature, salt, and ice also constrain the travel habitat.
- Adding animals to open water kills them in the supply command, including a paused edit. Adding water that floods animals also kills them immediately. Existing submerged populations die before feeding and navigation on the next physical step. Dead biomass becomes organic matter in the same cell; its mass and sensible heat remain in the world. Soil-retained moisture is not open water.
- Low-rate movement to adjacent suitable cells supports exploration when there is no reachable food. Land bridges can reconnect isolated populations.

The solver transfers donor-bounded biomass and sensible heat simultaneously. CPU and WebGPU use the same transfer implementation after local reactions. Food consumption, predation, reproduction, and mortality still belong to the local food-web reactions. Navigation is reconstructed from the committed state; it adds no save fields or persistent AI timer.

Hovering in Observe outlines one surface cell. Editing tools show their full selected footprint. The highlight only rebuilds selected faces.

The renderer shows up to 256 representatives per guild: rounded ivory seeds for herbivores and coral wedges for predators. Each guild uses one low-poly mesh and one reusable instance buffer; there are no faces, limbs, skeletons, or walking-leg matrices. The two meshes have 120 and 8 triangles, and their combined transform buffers occupy 32 KiB.

Paths stay on adjacent land cells with the same travel habitat constraints as the solver, including when wandering without food. Smooth position interpolation eases departure and arrival; the nose turns toward each new path before departure and preserves its final heading during rest. Predators rest for shorter intervals while following a prey route. Representatives are a visual sample of population biomass, not individually conserved agents. Visual pursuit does not calculate attacks or determine predation. Pausing stops their movement and skips unchanged matrix uploads; flooding or erasing their habitat removes the affected representatives.

## Surface refresh

Hexagonal terrain computes each tile's material blend once per snapshot. The water triangles write directly into reusable upload buffers and use precomputed coast neighbors. Terrain normals are recomputed only when the actual vertex positions change. These optimizations affect rendering only and do not lower simulation resolution or omit physics steps.

## Rotation and section selection

Freezing the displayed rotation applies within the current session. It is not restored from appearance preferences when the app reopens; saved physical spin settings and simulation pause remain intact. Section selection temporarily freezes the viewing frame, then restores the user's session choice on cancellation or opening the section. Returning to the globe hides the cut line, selected-cell highlights and endpoint handles. The selected range remains available when selecting a section again.

## Reproduce checks

Run `npm test` for transfer, barrier, conservation, display-bound, and pause checks. `tests/animal-lab.html` offers visible pause/flood controls, CPU/WebGPU comparisons, and a dense navigation benchmark. `tests/pour-performance-lab.html` compares immediate surface supply with legacy physical dust on the same 91-cell brush. Both fixtures use their own worlds and do not access application saves. Timings in the pouring fixture cover the supply/render path; they do not measure the entire atmosphere solver or establish a device-independent frame rate.

`tests/animal-performance-lab.html` measures 512 moving and paused representatives in one real render loop. Add `?cpu=1` for WebGL. A before/after audit can use `?reference=1` with an ignored snapshot at `artifacts/animal-tokens/animals-before.ts` and imports adjusted to the source tree. This fixture measures only animal display cost; it excludes atmosphere and simulation work.

`tests/ocean-mortality-lab.html` compares paused spawning on water and moist land across CPU, WebGPU and Worker, with and without layered climate. `tests/surface-performance-lab.html` measures wet terrain, forests and atmosphere rendering with a continuously changing 91-cell sand brush. A before/after audit can use `?reference=1` with an ignored snapshot at `artifacts/surface-performance/planet-before.ts`; preserve its shader and cosmetic-effect dependencies from the same revision when adjusting imports. The earlier surface-refresh audit compared commit `9c63d50` against `0.6.0-alpha.3`, before supply shading changed. This comparison measures the renderer's surface refresh, not atmosphere computation or the whole application's frame rate.

`tests/supply-pulse-lab.html` offers material previews and compares idle/effect CPU work, render submission, frame intervals and draw calls. Add `?cpu=1` to test WebGL. It also checks that fading requires no uploads, physical grains or new meshes. The fixture does not run the atmosphere solver and does not establish a device-independent frame rate.

Feeding animation uses the grazing and hunting amounts committed by the solver. A stationary representative briefly rests and dips when its cell consumed food. Body size follows its owner population’s biomass smoothly. Visual representatives do not consume additional food, and the feeding telemetry is transient rather than saved.
