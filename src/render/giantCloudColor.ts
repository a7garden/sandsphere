/** Compressed grey cloud opacity projected on the reference-pressure sphere.
 * Colors distinguish cloudy/clear columns, not unknown Jovian chromophores.
 * No latitude texture or independently moving painted bands are used. */
export function giantCloudColor(cloud:{ammoniaOpticalDepth:number;visibleWater:number;cloudPressure:number},visible=true){
 const base=[.64,.46,.31],white=[.95,.92,.84],cover=visible?-Math.expm1(-.065*cloud.ammoniaOpticalDepth-.7*cloud.visibleWater):0;
 const depthShade=visible?Math.exp(-Math.min(3,cloud.cloudPressure/1e5)*.08):1;
 return base.map((color,k)=>color*(1-cover)+white[k]*cover*depthShade);
}
