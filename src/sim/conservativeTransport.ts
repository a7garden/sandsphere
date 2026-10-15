/** Shared finite-volume exchange. Queue all outgoing requests against the old
 * inventory, then commit once. A domain supplies its geometry and energy;
 * this kernel cannot create matter or reset a parcel to a target temperature. */
export function outgoingScale(available:number,requested:number,fraction=1){
 return requested>0?Math.min(1,Math.max(0,available)*fraction/requested):0;
}

export function queueSpecies(mass:ArrayLike<number>,delta:Float64Array,width:number,from:number,to:number,species:number,fraction:number){
 const a=from*width+species,b=to*width+species,amount=mass[a]*fraction;
 delta[a]-=amount;delta[b]+=amount;
 return amount;
}

/** Tangent vectors are parallel-transported along a sphere's shortest edge.
 * Scratch output avoids allocating a vector per species or per edge. */
export function carryVelocity(velocity:ArrayLike<number>,q:number,directions:ArrayLike<number>,from:number,to:number,out:Float64Array){
 const v=q*3,n=from*3,m=to*3,x=velocity[v],y=velocity[v+1],z=velocity[v+2];
 if(from===to){out[0]=x;out[1]=y;out[2]=z;return;}
 const ax=directions[n+1]*directions[m+2]-directions[n+2]*directions[m+1],
  ay=directions[n+2]*directions[m]-directions[n]*directions[m+2],
  az=directions[n]*directions[m+1]-directions[n+1]*directions[m],
  dot=directions[n]*directions[m]+directions[n+1]*directions[m+1]+directions[n+2]*directions[m+2],
  bx=ay*z-az*y,by=az*x-ax*z,bz=ax*y-ay*x,denominator=Math.max(1e-9,1+dot);
 out[0]=x+bx+(ay*bz-az*by)/denominator;
 out[1]=y+by+(az*bx-ax*bz)/denominator;
 out[2]=z+bz+(ax*by-ay*bx)/denominator;
}

export function queueEnergyMomentum(from:number,to:number,mass:number,energy:number,velocity:ArrayLike<number>,carried:ArrayLike<number>,heat:Float64Array,momentum:Float64Array){
 heat[from]-=energy;heat[to]+=energy;
 for(let k=0;k<3;k++){
  momentum[from*3+k]-=mass*velocity[from*3+k];
  momentum[to*3+k]+=mass*carried[k];
 }
}

export function commitMomentum(q:number,oldMass:number,newMass:number,velocity:Float64Array,momentum:Float64Array,emptyThreshold=1e-18){
 for(let k=0;k<3;k++){
  const v=q*3+k;
  velocity[v]=newMass>emptyThreshold?(oldMass*velocity[v]+momentum[v])/newMass:0;
 }
}
