struct Cell { a:vec4f, b:vec4f, c:vec4f, d:vec4f, cloud:vec4f, life:vec4f, mars:vec4f, giant:vec4f, ammonia:vec4f, smoke:vec4f };
struct Flow { surface:vec4f, cloud:vec4f };
struct Params { control:vec4f, sun:vec4f, wind:vec4f };
@group(0) @binding(0) var<storage,read> source:array<Cell>;
@group(0) @binding(1) var<storage,read_write> prepared:array<Cell>;
@group(0) @binding(2) var<storage,read_write> flows:array<Flow>;
@group(0) @binding(3) var<storage,read_write> output:array<Cell>;
@group(0) @binding(4) var<storage,read> geometry:array<vec4f>;
@group(0) @binding(5) var<storage,read> neighbors:array<u32>;
@group(0) @binding(6) var<uniform> params:Params;
@group(0) @binding(7) var<storage,read_write> changes:array<f32>;

// SHARED_MATERIAL_ALGEBRA

fn height(i:u32,s:Cell)->f32 {
  return geometry[i].w+dot(s.a,vec4f(1))+s.b.y*1.09+s.b.z*0.5+s.c.w+s.d.x+s.cloud.z*.6+s.life.z*.3+s.mars.x*.64+s.mars.y+s.ammonia.z*.8;
}
fn edgeScale(distance:f32)->f32 {let d=4.8/.024*sqrt(12.56637061436/2562.0)/max(.000001,distance);return d*d;}
fn conductivity(s:Cell)->f32 {
 let k=1.3+dot(s.a,vec4f(.32,.55,.18,.6))+dot(s.b,vec4f(.7,1.4,.9,.9))+s.c.y*.08+s.c.w*.8+dot(s.d,vec4f(1.3,.08,.08,.08))+dot(s.cloud,vec4f(.7,1.4,.35,.25))+dot(s.life.xyz,vec3f(.25,.25,12))+dot(s.mars,vec4f(.5,.32,.08,.08))+dot(s.ammonia.zw,vec2f(.18,.08))+s.smoke.x*.08;
 let mass=1.0+dot(s.a,vec4f(1))+dot(s.b,vec4f(1))+s.c.y+s.c.w+dot(s.d,vec4f(1))+dot(s.cloud,vec4f(1))+dot(s.life.xyz,vec3f(1))+dot(s.mars,vec4f(1))+s.ammonia.z+s.ammonia.w+s.smoke.x;return k/mass;
}
fn surfaceLight(s:Cell,i:u32)->f32{return max(0.0,dot(geometry[i].xyz,params.sun.xyz))*params.control.w*(1.0-(1.0-exp(-(s.cloud.x+s.cloud.y)*3.0))*.65);}
fn plantHabitat(s:Cell,light:f32)->f32{return max(0.0,1.0-abs(s.c.x-22.0)/32.0)*min(1.0,s.b.x/.12)*max(0.0,1.0-s.b.x/5.0)*max(0.0,1.0-s.b.w/max(.001,s.b.x)*8.0)*exp(-s.b.y*2.0)*min(1.0,light*1.8)*select(1.0,clamp((s.a.x+s.a.y+s.cloud.z)*4.0,0.0,1.0),params.wind.y>0.5);}
fn meltMobility(t:f32)->f32{if(t<=1400){return 0.0;}return .025+.175*clamp((t-1400.0)/400.0,0.0,1.0);}
@compute @workgroup_size(64)
fn apply(@builtin(global_invocation_id) gid:vec3u) {
 let i=gid.x;if(i>=u32(params.control.x)){return;}
 prepared[i]=source[i];
 changes[i]=0.0;
}

@compute @workgroup_size(64)
fn flux(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x;if(i>=u32(params.control.x)){return;}
  let s=prepared[i];let h=height(i,s);let head=h+s.b.x;let dt=params.control.y;
  let wet=s.b.x/max(0.1,s.a.x+s.a.y);
  var repose=0.28;
  if(wet<0.025){repose=0.58;}else if(wet<0.35){repose=0.95;}
  var sum=vec3f(0);var cloudSum=0.0;var meltSum=0.0;var charcoalSum=0.0;
  for(var k=0u;k<6u;k++){
    let edge=i*6u+k;let j=neighbors[edge];
    var f=vec4f(0);var cloud=vec4f(0);
    if(j!=0xffffffffu){
      let other=prepared[j];let hn=height(j,other);
      let distance=length(geometry[i].xyz-geometry[j].xyz)*4.8/0.024;
      // Water and bed materials use the shared host mechanical energy budget.
      let fraction=select(dt*.035*edgeScale(distance),0.0,params.wind.y>0.5);cloudSum+=fraction;cloud=vec4f(s.cloud.xy*fraction,0.0,0.0);
    }
    sum+=f.xyz;flows[edge]=Flow(f,cloud);
  }
  let mobileWater=max(0.0,s.b.x-min(1.2,s.cloud.z*0.12));
  let factors=min(vec3f(1),vec3f(mobileWater*0.35,s.a.x*0.25,s.a.y*0.2)/max(vec3f(0.00000001),sum));
  for(var k=0u;k<6u;k++){
    let edge=i*6u+k;
    var flow=flows[edge];var f=flow.surface;f=vec4f(f.xyz*factors,0);
    f.w=f.x*s.b.w/max(0.000001,s.b.x);
    flow.surface=f;flow.cloud=vec4f(flow.cloud.xy*min(1.0,0.45/max(.00000001,cloudSum)),flow.cloud.z*min(1.0,s.c.w*.2/max(.00000001,meltSum)),flow.cloud.w*min(1.0,s.ammonia.z*.25/max(.00000001,charcoalSum)));flows[edge]=flow;
  }
}

@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x;if(i>=u32(params.control.x)){return;}
  let original=prepared[i];var s=original;
  if(params.control.y<=0){output[i]=original;return;}
  var energy=0.0;
  var firingDose=original.a.y*original.c.z;
  var conduction=0.0;let dt=params.control.y;
  for(var k=0u;k<6u;k++){
    let edge=i*6u+k;let j=neighbors[edge];if(j==0xffffffffu){continue;}
    var reciprocal=0u;
    for(var r=0u;r<6u;r++){if(neighbors[j*6u+r]==i){reciprocal=r;break;}}
    let outgoingFlow=flows[edge];let incomingFlow=flows[j*6u+reciprocal];
    let outgoing=outgoingFlow.surface;let incoming=incomingFlow.surface;
    firingDose+=incoming.y*prepared[j].c.z-outgoing.y*original.c.z;
    s.cloud=vec4f(s.cloud.xy+incomingFlow.cloud.xy-outgoingFlow.cloud.xy,s.cloud.zw);s.c.w+=incomingFlow.cloud.z-outgoingFlow.cloud.z;
    s.ammonia.z+=incomingFlow.cloud.w-outgoingFlow.cloud.w;
    energy+=(incomingFlow.cloud.w*prepared[j].c.x-outgoingFlow.cloud.w*original.c.x)*cpCharcoal;
    energy+=(incomingFlow.cloud.z*prepared[j].c.x-outgoingFlow.cloud.z*original.c.x)*cpMolten;
    energy+=dot(incomingFlow.cloud.xy*prepared[j].c.x-outgoingFlow.cloud.xy*original.c.x,cpCloud);
    let change=incoming-outgoing;
    s.b.x+=change.x;s.a.x+=change.y;s.a.y+=change.z;s.b.w+=change.w;
    energy+=dot(incoming*prepared[j].c.x-outgoing*original.c.x,cpSurface);
    let distance=length(geometry[i].xyz-geometry[j].xyz)*4.8/.024;let spatial=edgeScale(distance);
    let here=plantHabitat(original,surfaceLight(original,i));
    let there=plantHabitat(prepared[j],surfaceLight(prepared[j],j));
    let biomass=(prepared[j].cloud.w*here-original.cloud.w*there)*min(dt*spatial*.004,1.0/6.0);
    s.cloud.w+=biomass;
    energy+=biomass*cpPlant*select(original.c.x,prepared[j].c.x,biomass>=0.0);
    let ka=conductivity(original);let kb=conductivity(prepared[j]);
    conduction+=(prepared[j].c.x-original.c.x)*min(dt*2.0*ka*kb/max(1e-8,ka+kb)*spatial,min(capacity(original),capacity(prepared[j]))/12.0);
    let diff=(prepared[j].c.y-original.c.y)*min(dt*.28*spatial,1.0/6.0);
    s.c.y+=diff;
    energy+=diff*cpVapor*select(original.c.x,prepared[j].c.x,diff>=0.0);
    let gases=(prepared[j].d.yzw-original.d.yzw)*min(dt*.6*spatial,1.0/6.0);
    let oxygen=(prepared[j].mars.w-original.mars.w)*min(dt*.6*spatial,1.0/6.0);
    s.mars.w+=oxygen;energy+=oxygen*cpOxygen*select(original.c.x,prepared[j].c.x,oxygen>=0.0);
    let soot=(prepared[j].smoke.x-original.smoke.x)*min(dt*.28*spatial,1.0/6.0);
    s.smoke.x+=soot;energy+=soot*cpSoot*select(original.c.x,prepared[j].c.x,soot>=0.0);
    let co=(prepared[j].ammonia.w-original.ammonia.w)*min(dt*.6*spatial,1.0/6.0);
    s.ammonia.w+=co;energy+=co*cpCO*select(original.c.x,prepared[j].c.x,co>=0.0);
    s.d=vec4f(s.d.x,s.d.yzw+gases);
    energy+=dot(gases*select(vec3f(original.c.x),vec3f(prepared[j].c.x),gases>=vec3f(0)),cpGas);
  }
  let deltaCapacity=capacityChange(s,original);let targetHeat=energy+conduction;
  s.c.x=original.c.x+(targetHeat-original.c.x*deltaCapacity)/capacity(s);
  let storedHeat=capacity(s)*(s.c.x-original.c.x)+deltaCapacity*original.c.x;
  let transferRoundoff=storedHeat-targetHeat;
  s.c.z=select(0.0,max(0.0,firingDose)/max(.00000001,s.a.y),s.a.y>.00000001);
  output[i]=s;
  changes[i]=transferRoundoff;
}
