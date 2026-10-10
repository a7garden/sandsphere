// Calibrated game materials: kJ-like energy, game kg, Celsius referenced at 0°C.
// Ceramic firing has zero net reaction heat in this model. Glass retains the
// molten structural offset; this is not a claim of crystalline freezing latent heat.
export const BASE_CAPACITY=28;
export const SPECIFIC_HEAT=[.8,1,.9,.8,4.18,2.1,.85,.85,0,2,0,.8,.84,1.04,2.22,.85,4.18,2.1,1,1,1,1,.45,1] as const;
export const PHASE_ENERGY=[0,0,0,150,0,-334,0,0,0,2475,0,150,0,0,0,0,0,-334,0,0,0,0,0,0] as const;
export const SUPPLY_TEMPERATURE=SPECIFIC_HEAT.map((_,field)=>field===5?-5:20);
export const ENERGY_CHANNELS=4; // environment, commands, escape, numerical corrections
