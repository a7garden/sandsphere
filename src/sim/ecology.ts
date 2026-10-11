/** Biomass guilds and deliberately broad tolerances, not individual species physiology. */
export function openSurfaceWater(water:number,soil:number){return Math.max(0,water-Math.min(1.2,soil*.12))>=.035;}
export function habitat(temperature:number,water:number,salt:number,ice:number,light:number){
 const warmth=Math.max(0,1-Math.abs(temperature-22)/32);
 const moisture=Math.min(1,water/.12)*Math.max(0,1-water/5);
 const salinity=Math.max(0,1-salt/Math.max(.001,water)*8);
 return warmth*moisture*salinity*Math.exp(-ice*2)*Math.min(1,Math.max(0,light)*1.8);
}
export function consumerHabitat(temperature:number,water:number,salt:number,ice:number,predator=false){
 const warmth=Math.max(0,1-Math.abs(temperature-(predator?26:22))/(predator?50:45));
 return warmth*Math.min(1,water/.04)*Math.max(0,1-water/7)*Math.max(0,1-salt/Math.max(.001,water)*6)*Math.exp(-ice*.7);
}
/** Travel can cross dry land even when the local feeding habitat lacks water. */
export function consumerTravelHabitat(temperature:number,water:number,salt:number,ice:number,predator=false){
 const warmth=Math.max(0,1-Math.abs(temperature-(predator?26:22))/(predator?50:45));
 return warmth*Math.max(0,1-salt/Math.max(.001,water)*6)*Math.exp(-ice*.7);
}
export function foodWeb(soil:number,plant:number,herbivore:number,carnivore:number,suitability:number,dt:number,herbivoreHabitat=1,carnivoreHabitat=1,feeding?:Float32Array,offset=0){
 const growth=Math.min(soil,plant*.085*suitability*dt);soil-=growth;plant+=growth;
 const grazing=Math.min(plant,herbivore*.12*herbivoreHabitat*dt),hunting=Math.min(herbivore,carnivore*.075*carnivoreHabitat*dt);
 if(feeding){feeding[offset]+=grazing;feeding[offset+1]+=hunting;}
 plant-=grazing;herbivore+=grazing*.36-hunting;carnivore+=hunting*.3;soil+=grazing*.64+hunting*.7;
 const pd=Math.min(plant,plant*(.0015+(1-suitability)*.009)*dt);
 const hd=Math.min(herbivore,herbivore*(.003+(grazing<herbivore*.015*dt?.018:0)+(1-herbivoreHabitat)*.12)*dt);
 const cd=Math.min(carnivore,carnivore*(.002+(hunting<carnivore*.008*dt?.012:0)+(1-carnivoreHabitat)*.1)*dt);
 return [soil+pd+hd+cd,plant-pd,herbivore-hd,carnivore-cd] as const;
}
