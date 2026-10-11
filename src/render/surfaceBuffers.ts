/** Hex tiles own one depth/ice value and a complete triangle. Write directly
 * into reusable GPU staging arrays rather than allocating clipped polygons. */
export function writeHexWater(offset:number,a:number,b:number,c:number,owner:number,
  water:Float32Array,ground:Float32Array,directions:Float32Array,depth:number,ice:number,inset:number,coastEdge:boolean,
  positions:Float32Array,normals:Float32Array,colors:Float32Array){
  if(depth<.035)return;
  for(let k=0;k<3;k++){
    const v=(k===0?a:k===1?b:c)*3,r=Math.hypot(water[v],water[v+1],water[v+2]);
    const floor=Math.hypot(ground[v],ground[v+1],ground[v+2])+.008,scale=(Math.max(r,floor)-inset)/r;
    const p=(offset+k)*3,q=(offset+k)*4;
    for(let j=0;j<3;j++){positions[p+j]=water[v+j]*scale;normals[p+j]=directions[owner*3+j];}
    colors[q]=ice;colors[q+1]=coastEdge&&k>0?1:0;colors[q+2]=0;colors[q+3]=depth;
  }
}
