/** Observation follows the cursor until a surface cell is pinned. */
export class ObservationPoint {
  cell=0;
  selecting=false;
  private planet='';
  private pins=new Map<string,number>();
  get pinned(){return this.pins.has(this.planet);}
  switchPlanet(id:string,fallback=0){
    this.planet=id;this.selecting=false;this.cell=this.pins.get(id)??fallback;
  }
  hover(cell:number){if(!this.pinned&&!this.selecting)this.cell=cell;}
  pin(cell:number){this.pins.set(this.planet,cell);this.cell=cell;this.selecting=false;}
  clear(){this.pins.delete(this.planet);this.selecting=false;}
}
