/** Kessler warm-rain closure, SI. Published ERF theory equations:
 * https://erf.readthedocs.io/en/latest/theory/Microphysics.html
 * Accretion: 2.2 qc qr^0.875; fall speed:
 * 36.34 (rho qr)^0.1346 (rho/1.225)^(-1/2) m/s.
 * Invert F=rho qr vt for a diagnostic rain flux (no prognostic rain pool).
 */
export function diagnosticRainMixingRatio(fluxKgM2S:number,densityKgM3:number){
 if(fluxKgM2S<=0||densityKgM3<=0)return 0;
 return (fluxKgM2S/(36.34*densityKgM3**1.1346*Math.sqrt(1.225/densityKgM3)))**(1/1.1346);
}
export function kesslerAccretedFraction(rainMixingRatio:number,seconds:number){return -Math.expm1(-2.2*Math.max(0,rainMixingRatio)**.875*Math.max(0,seconds));}

/** Khairoutdinov–Kogan (2000): 1350 qc^2.47 Nc^-1.79, with Nc
 * in cm^-3 and qc in kg/kg. Exact integration holds droplet number fixed.
 * Nc=100 is a declared marine-like boundary assumption, not a POWER fit.
 * GMD 9,2031 (2016), supplement S11. No aerosol forecast is implied. */
export function warmAutoFraction(cloudMixingRatio:number,seconds:number,dropletNumberCm3=100){
 const a=1350*dropletNumberCm3**-1.79,p=1.47;
 return -Math.expm1(-Math.log1p(p*a*Math.max(0,cloudMixingRatio)**p*Math.max(0,seconds))/p);
}
/** Lin et al. cloud ice -> snow (WRF Lin implementation):
 * alpha=1e-3 exp(.025 T_C), qiCrit=1e-3 kg/kg above -20 C;
 * colder qiCrit=1e-3 exp[-7.6+4 exp(-.0002443(|T|-20)^2.455)]/rho.
 * Only this conversion is ported; this is not the full six-class Lin scheme.
 */
export function iceAggregation(cloudIceKgKg:number,temperatureC:number,densityKgM3:number,seconds:number){
 const critical=temperatureC< -20?1e-3*Math.exp(-7.6+4*Math.exp(-.0002443*(Math.abs(temperatureC)-20)**2.455))/Math.max(1e-12,densityKgM3):.001;
 return Math.max(0,cloudIceKgKg-critical)*(-Math.expm1(-.001*Math.exp(.025*Math.min(0,temperatureC))*seconds));
}
