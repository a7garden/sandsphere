# Material supply and land animal movement

These behaviors are under development in `0.6.0-alpha.2`.

## Surface supply

The surface brush adds each cell's weighted share to the next solver command batch immediately. It retains the brush footprint, material inventory rules, and total supplied mass. Paused edits can commit with a zero-duration step. Supply cues are cosmetic: at most six appear per stroke, and the reusable pool holds at most 48 across all materials. They expire in display time and never appear in pending mass or saved material inventories.

Picks in open air use the same immediate brush delivery at the selected surface cells. They do not create airborne material, wait for gravity, or accumulate physical dust during paused strokes. Gas delivery continues to use the atmosphere command fields. The legacy falling-parcel solver remains available to physical test fixtures; the application brush does not call it.

## Land animal movement

The simulation stores herbivore and predator biomass per cell, rather than a list of individual animals. Each guild shares a multi-source Dijkstra navigation field. This avoids a separate path search for each displayed animal.

- Herbivores seek accessible vegetation. Path costs include travel distance, slope, competition, and predator risk.
- Predators seek accessible herbivore biomass. Travel distance, slope, and competing predators affect the chosen destination.
- Open surface water and molten ground block incoming movement. Soil-retained moisture permits land travel. Temperature, salt, and ice also constrain the travel habitat.
- Low-rate movement to adjacent suitable cells supports exploration when there is no reachable food. Land bridges can reconnect isolated populations.

The solver transfers donor-bounded biomass and sensible heat simultaneously. CPU and WebGPU use the same transfer implementation after local reactions. Food consumption, predation, reproduction, and mortality still belong to the local food-web reactions. Navigation is reconstructed from the committed state; it adds no save fields or persistent AI timer.

The renderer shows up to 256 representatives per guild, with walking legs and paths restricted to adjacent land cells. Representatives follow the shared navigation field, periodically rest, and explore locally near food. They are a visual sample of population biomass, not individually conserved agents. Visual pursuit does not calculate attacks or determine predation. Pausing stops their walking; flooding or erasing their habitat removes the affected representatives.

## Reproduce checks

Run `npm test` for transfer, barrier, conservation, display-bound, and pause checks. `tests/animal-lab.html` offers visible pause/flood controls, CPU/WebGPU comparisons, and a dense navigation benchmark. `tests/pour-performance-lab.html` compares immediate surface supply with legacy physical dust on the same 91-cell brush. Both fixtures use their own worlds and do not access application saves. Timings in the pouring fixture cover the supply/render path; they do not measure the entire atmosphere solver or establish a device-independent frame rate.
