/** Stable cloud families: one bank can stay whole or split into a few unequal
 * patches. Footprint weights sum to one, so splitting does not multiply cover. */
export function cloudComposition(seed:number,size:number){
 const family=size<.28?0:((seed*13+Math.floor(seed/5))%4);
 const layouts=[
  [[0,0,1]],
  [[-.20,-.05,.72],[.83,.26,.28]],
  [[-.20,-.08,.52],[.72,.27,.29],[-.56,.68,.19]],
  [[-.32,-.10,.45],[.54,.20,.26],[1.13,.43,.18],[-.88,-.49,.11]],
 ];
 return layouts[family].map(([x,z,weight],i)=>{
  const radius=Math.sqrt(weight),stretch=1+Math.sin(seed*1.31+i*2.7)*.14;
  return {x:x+(i?Math.sin(seed*2.1+i)*.10:0),z:z+(i?Math.cos(seed*1.7+i*2)*.12:0),y:i===0?0:Math.sin(seed+i)*.08,
   width:radius*stretch,depth:radius/stretch,height:.70+radius*.30,
   yaw:Math.sin(seed*1.9+i*2.3)*.32,variant:(seed+i*5)%6,weight};
 });
}
