struct Cell { a:vec4f, b:vec4f, c:vec4f, d:vec4f, cloud:vec4f, life:vec4f };
struct Flow { surface:vec4f, cloud:vec4f };
struct Command { deposit:vec4f, tools:vec4f, gas:vec4f, products:vec4f, life:vec4f };
struct Params { control:vec4f, sun:vec4f, wind:vec4f };
struct Changes { escape:vec4f, weather:vec4f, energy:vec4f };
@group(0) @binding(0) var<storage,read> source:array<Cell>;
@group(0) @binding(1) var<storage,read_write> prepared:array<Cell>;
@group(0) @binding(2) var<storage,read_write> flows:array<Flow>;
@group(0) @binding(3) var<storage,read_write> output:array<Cell>;
@group(0) @binding(4) var<storage,read> geometry:array<vec4f>;
@group(0) @binding(5) var<storage,read> neighbors:array<u32>;
@group(0) @binding(6) var<storage,read> commands:array<Command>;
@group(0) @binding(7) var<uniform> params:Params;
@group(0) @binding(8) var<storage,read_write> changes:array<Changes>;

// Stable 1-exp(-x) for substep rates: avoid cancellation at Float32 precision.
fn lossFraction(x:f32)->f32 {
 let v=max(0.0,x);if(v<.01){return v*(1.0-v*.5+v*v/6.0-v*v*v/24.0);}return 1.0-exp(-v);
}

fn emptyCommand(cmd:Command)->bool{return all(cmd.deposit==vec4f(0))&&all(cmd.tools==vec4f(0))&&all(cmd.gas==vec4f(0))&&all(cmd.products==vec4f(0))&&all(cmd.life==vec4f(0));}

fn capacity(s:Cell)->f32 {
  return 28.0+dot(s.a,vec4f(0.8,1.0,0.9,0.8))
    +dot(s.b,vec4f(4.18,2.1,0.85,0.85))+s.c.y*2.0+s.c.w*0.8+dot(s.d,vec4f(0.84,1.04,2.22,0.85))+dot(s.cloud,vec4f(4.18,2.1,1,1))+dot(s.life.xyz,vec3f(1,1,.45))+s.life.w;
}
fn height(i:u32,s:Cell)->f32 {
  return geometry[i].w+dot(s.a,vec4f(1))+s.b.y*1.09+s.b.z*0.5+s.c.w+s.d.x+s.cloud.z*.6+s.life.z*.3;
}
fn freezing(water:f32,salt:f32)->f32 {
  let total=water+salt;if(total<=0){return 0.0;}return -min(18.0,54.0*salt/total);
}
fn saturationPressure(temperature:f32,ice:bool)->f32 {
 let t=clamp(temperature+273.15,123.0,647.096);
 if(ice&&t<=273.16){return exp(9.550426-5723.265/t+3.53068*log(t)-.00728332*t);}
 if(t<273.16){let x=.0415*(t-218.8);let tanh=(exp(2.0*x)-1.0)/(exp(2.0*x)+1.0);return exp(54.842763-6763.22/t-4.210*log(t)+.000367*t+tanh*(53.878-1331.22/t-9.44523*log(t)+.014025*t));}
 let v=1.0-t/647.096;return 22064000.0*exp(647.096/t*(-7.85951783*v+1.84408259*pow(v,1.5)-11.7866497*pow(v,3.0)+22.6807411*pow(v,3.5)-15.9618719*pow(v,4.0)+1.80122502*pow(v,7.5)));
}
fn waterActivity(s:Cell)->f32 {if(s.b.x<=.00000001){return 1.0;}return 1.0/(1.0+2.0*.018015/.05844*max(0.0,s.b.w)/s.b.x);}
fn columnPressure(s:Cell)->f32 {return (s.c.y+s.d.y+s.d.z+s.d.w)*params.sun.w/.3*101325.0;}
fn boilingPoint(s:Cell,activity:f32)->f32 {
 let p=clamp(columnPressure(s)/max(.01,activity),saturationPressure(0.0,false),saturationPressure(180.0,false));var lo=0.0;var hi=180.0;
 for(var n=0;n<22;n++){let mid=(lo+hi)*.5;if(saturationPressure(mid,false)<p){lo=mid;}else{hi=mid;}}return (lo+hi)*.5;
}
fn saturation(s:Cell,t:f32,ice:bool,activity:f32)->f32 {
 let dry=s.d.y+s.d.z+s.d.w;let moles=dot(s.d.yzw,vec3f(1.0/.028014,1.0/.016043,1.0/.04401));let e=saturationPressure(t,ice)*activity;let k=101325.0*params.sun.w/.3;let b=k*dry-e;let c=e*.018015*moles;let root=sqrt(b*b+4.0*k*c);
 if(b>=0){return 2.0*c/max(1e-30,root+b);}return (root-b)/(2.0*k);
}
fn edgeScale(distance:f32)->f32 {let d=4.8/.024*sqrt(12.56637061436/2562.0)/max(.000001,distance);return d*d;}
fn conductivity(s:Cell)->f32 {
 let k=1.3+dot(s.a,vec4f(.32,.55,.18,.6))+dot(s.b,vec4f(.7,1.4,.9,.9))+s.c.y*.08+s.c.w*.8+dot(s.d,vec4f(1.3,.08,.08,.08))+dot(s.cloud,vec4f(.7,1.4,.35,.25))+dot(s.life.xyz,vec3f(.25,.25,12));
 let mass=1.0+dot(s.a,vec4f(1))+dot(s.b,vec4f(1))+s.c.y+s.c.w+dot(s.d,vec4f(1))+dot(s.cloud,vec4f(1))+dot(s.life.xyz,vec3f(1));return k/mass;
}
fn surfaceAlbedo(s:Cell)->f32 {
 let a=.38+dot(s.a,vec4f(.45,.27,.32,.12))+dot(s.b,vec4f(1.2,5.76,.6,.6))+s.c.w*.12+s.d.x*.38+dot(s.cloud.zw,vec2f(.2,.18))+dot(s.life.xyz,vec3f(.25,.25,.26));
 let mass=1.0+dot(s.a,vec4f(1))+dot(s.b,vec4f(8,8,1,1))+s.c.w+s.d.x+dot(s.cloud.zw,vec2f(1))+dot(s.life.xyz,vec3f(1));return a/mass;
}
fn surfaceLight(s:Cell,i:u32)->f32{return max(0.0,dot(geometry[i].xyz,params.sun.xyz))*params.control.w*(1.0-(1.0-exp(-(s.cloud.x+s.cloud.y)*3.0))*.65);}
fn consumerHabitat(s:Cell,predator:bool)->f32 {
 let warmth=max(0.0,1.0-abs(s.c.x-select(22.0,26.0,predator))/select(45.0,50.0,predator));return warmth*min(1.0,s.b.x/.04)*max(0.0,1.0-s.b.x/7.0)*max(0.0,1.0-s.b.w/max(.001,s.b.x)*6.0)*exp(-s.b.y*.7);
}
fn plantHabitat(s:Cell,light:f32)->f32{return max(0.0,1.0-abs(s.c.x-22.0)/32.0)*min(1.0,s.b.x/.12)*max(0.0,1.0-s.b.x/5.0)*max(0.0,1.0-s.b.w/max(.001,s.b.x)*8.0)*exp(-s.b.y*2.0)*min(1.0,light*1.8)*select(1.0,clamp((s.a.x+s.a.y+s.cloud.z)*4.0,0.0,1.0),params.wind.y>0.5);}
fn meltMobility(t:f32)->f32{if(t<=1400){return 0.0;}return .025+.175*clamp((t-1400.0)/400.0,0.0,1.0);}
fn phaseEnergy(s:Cell)->f32 {return 150.0*(s.a.w+s.c.w)+2475.0*s.c.y-334.0*(s.b.y+s.cloud.y);}
fn enthalpy(s:Cell)->f32 {return capacity(s)*s.c.x+phaseEnergy(s);}
fn waterTrial(total:f32,salt:f32,base:f32,otherPhase:f32,h:f32,water:f32)->vec2f {
  let ice=total-water;let dissolved=min(salt,water*.36);var tf=freezing(water,dissolved);
  if(water==0.0&&salt>0.0){tf=freezing(1.0,.36);}
  return vec2f((h-otherPhase+334.0*ice)/(base+water*4.18+ice*2.1),tf);
}
fn equilibrateWater(initial:Cell)->Cell {
  var s=initial;let total=s.b.x+s.b.y;let salt=s.b.z+s.b.w;if(total<=0){s.b.z=salt;s.b.w=0.0;return s;}
  let h=enthalpy(s);let base=capacity(s)-s.b.x*4.18-s.b.y*2.1;
  let otherPhase=phaseEnergy(s)+334.0*s.b.y;
  var water=total;let liquid=waterTrial(total,salt,base,otherPhase,h,total);let solid=waterTrial(total,salt,base,otherPhase,h,0.0);
  if(liquid.x<liquid.y){
    if(solid.x<=solid.y){water=0.0;}else{
      var lo=0.0;var hi=total;
      for(var n=0;n<24;n++){let mid=(lo+hi)*.5;let v=waterTrial(total,salt,base,otherPhase,h,mid);if(v.x>v.y){lo=mid;}else{hi=mid;}}
      water=(lo+hi)*.5;
    }
  }
  if(water<=total*.5){s.b.x=water;s.b.y=max(0.0,total-s.b.x);}else{s.b.y=total-water;s.b.x=max(0.0,total-s.b.y);}
  let dissolved=min(salt,s.b.x*.36);
  if(dissolved<=salt*.5){s.b.w=dissolved;s.b.z=max(0.0,salt-s.b.w);}else{s.b.z=salt-dissolved;s.b.w=max(0.0,salt-s.b.z);}
  s.c.x=(h-phaseEnergy(s))/capacity(s);return s;
}

fn drownConsumers(initial:Cell)->Cell {
  var s=initial;
  if(max(0.0,s.b.x-min(1.2,s.cloud.z*.12))>=.035){s.cloud.z+=s.life.x+s.life.y;s.life.x=0.0;s.life.y=0.0;}
  return s;
}
@compute @workgroup_size(64)
fn apply(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x;if(i>=u32(params.control.x)){return;}
  var s=source[i];let cmd=commands[i];let old=capacity(s);let dose=s.a.y*s.c.z;
  if(emptyCommand(cmd)){prepared[i]=s;return;}
  let added=dot(cmd.deposit,vec4f(4.18,0.8,1.0,0.85))+dot(cmd.gas.xyz,vec3f(1.04,2.22,0.85))+dot(cmd.products,vec4f(2.1,0.9,0.8,1))+dot(cmd.life,vec4f(1,1,1,.45));
  s.b.x+=cmd.deposit.x;s.a.x+=cmd.deposit.y;s.a.y+=cmd.deposit.z;s.b.z+=cmd.deposit.w;
  s.d=vec4f(s.d.x,s.d.yzw+cmd.gas.xyz);
  s.b.y+=cmd.products.x;s.a.z+=cmd.products.y;s.a.w+=cmd.products.z;s.cloud.z+=cmd.products.w;s.cloud.w+=cmd.life.x;s.life+=vec4f(cmd.life.yzw,0);
  if(added!=0||cmd.tools.x!=0){s.c.x=(s.c.x*old+added*20.0-cmd.products.x*2.1*25.0+cmd.tools.x)/capacity(s);}
  if(cmd.deposit.z!=0){s.c.z=select(0.0,dose/max(.00000001,s.a.y),s.a.y>.00000001);}
  let keep=1.0-clamp(cmd.tools.y,0.0,1.0);
  s.a*=keep;s.b*=keep;s.c.w*=keep;s.cloud=vec4f(s.cloud.xy,s.cloud.zw*keep);s.life*=keep;
  // Surface-section tools do not touch hidden bedrock or atmospheric reservoirs.
  if(cmd.tools.w<=0.0){s.c.y*=keep;s.d*=keep;s.cloud=vec4f(s.cloud.xy*keep,s.cloud.zw);}
  if(cmd.tools.y>0&&s.a.y<0.001){s.c.z=0.0;}
  let keepProduct=1.0-clamp(cmd.tools.z,0.0,1.0);s.b.y*=keepProduct;s.a.z*=keepProduct;s.a.w*=keepProduct;s.cloud.w*=keepProduct;s.life=vec4f(s.life.xyz*keepProduct,s.life.w);
  if(cmd.deposit.x>0.0||cmd.life.y>0.0||cmd.life.z>0.0){s=drownConsumers(s);}
  prepared[i]=s;
}

@compute @workgroup_size(64)
fn flux(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x;if(i>=u32(params.control.x)){return;}
  let s=prepared[i];let h=height(i,s);let head=h+s.b.x;let dt=params.control.y;
  let wet=s.b.x/max(0.1,s.a.x+s.a.y);
  var repose=0.28;
  if(wet<0.025){repose=0.58;}else if(wet<0.35){repose=0.95;}
  var sum=vec3f(0);var cloudSum=0.0;var meltSum=0.0;
  let latitude=abs(geometry[i].y);var band=-0.35;if(latitude<0.5){band=-0.55;}else if(latitude<0.87){band=0.8;}
  let rotation=select(1.0,-1.0,params.wind.x<0.0)*(0.35+min(1.65,abs(params.wind.x)*120.0/6.28318530718));
  let normal=geometry[i].xyz;let heating=dot(normal,params.sun.xyz);
  let wind=vec3f(normal.z,0,-normal.x)*band*rotation-(params.sun.xyz-normal*heating)*0.32;
  for(var k=0u;k<6u;k++){
    let edge=i*6u+k;let j=neighbors[edge];
    var f=vec4f(0);var cloud=vec4f(0);
    if(j!=0xffffffffu){
      let other=prepared[j];let hn=height(j,other);
      let distance=length(geometry[i].xyz-geometry[j].xyz)*4.8/0.024;
      f.x=max(0.0,head-hn-other.b.x)*dt*1.1*params.sun.w*edgeScale(distance);
      f.y=max(0.0,h-hn-distance*repose)*dt*1.2*params.sun.w*edgeScale(distance);
      f.z=max(0.0,h-hn-distance*select(1.1,0.2,wet>0.5))*dt*0.4*params.sun.w*edgeScale(distance);
      let delta=geometry[j].xyz-normal;let alignment=dot(wind,delta)/max(0.000001,length(delta));
      let fraction=select(dt*(.035*edgeScale(distance)+max(0.0,alignment)*.85*(4.8/.024*sqrt(12.56637061436/2562.0))/distance),0.0,params.wind.y>0.5);cloudSum+=fraction;let melt=max(0.0,h-hn)*dt*meltMobility(s.c.x)*params.sun.w*edgeScale(distance);meltSum+=melt;cloud=vec4f(s.cloud.xy*fraction,melt,0);
    }
    sum+=f.xyz;flows[edge]=Flow(f,cloud);
  }
  let mobileWater=max(0.0,s.b.x-min(1.2,s.cloud.z*0.12));
  let factors=min(vec3f(1),vec3f(mobileWater*0.35,s.a.x*0.25,s.a.y*0.2)/max(vec3f(0.00000001),sum));
  for(var k=0u;k<6u;k++){
    let edge=i*6u+k;
    var flow=flows[edge];var f=flow.surface;f=vec4f(f.xyz*factors,0);
    f.w=f.x*s.b.w/max(0.000001,s.b.x);
    flow.surface=f;flow.cloud=vec4f(flow.cloud.xy*min(1.0,0.45/max(.00000001,cloudSum)),flow.cloud.z*min(1.0,s.c.w*.2/max(.00000001,meltSum)),0);flows[edge]=flow;
  }
}

fn reaction(initial:Cell,i:u32)->Cell {
  var tools=0.0;if(!emptyCommand(commands[i])){tools=enthalpy(prepared[i])-enthalpy(source[i]);}
  if(params.control.y<=0){changes[i]=Changes(vec4f(0),vec4f(0),vec4f(0,tools,0,0));return initial;}
  var s=initial;
  s.a=max(s.a,vec4f(0));s.b=max(s.b,vec4f(0));s.c.y=max(0.0,s.c.y);s.c.w=max(0.0,s.c.w);s.d=max(s.d,vec4f(0));s.cloud=max(s.cloud,vec4f(0));s.life=max(s.life,vec4f(0));
  var numerical=enthalpy(s)-enthalpy(initial);
  let dt=params.control.y;var c=capacity(s);var t=s.c.x;var condensed=0.0;var rainReaching=0.0;var snowReaching=0.0;
  let exposure=max(0.0,dot(geometry[i].xyz,params.sun.xyz));
  let light=surfaceLight(s,i);
  let equilibrium=params.control.z+72.0*light*(1.0-surfaceAlbedo(s))-24.0*params.control.w;
  let environmentHeat=select(c*(equilibrium-t)*lossFraction(dt*.032*28.0/c),0.0,params.wind.y>0.5);t+=environmentHeat/c;
  s.c.x=t;s=equilibrateWater(s);t=s.c.x;c=capacity(s);
  let tf=freezing(s.b.x,s.b.w);let activity=waterActivity(s);var boiling=100.0;if(s.b.x+s.b.y+s.c.y+s.cloud.x+s.cloud.y>0){boiling=boilingPoint(s,activity);}
  if(params.wind.y<0.5&&s.b.x>0 && t>tf+0.3){
    let dry=max(0.0,1.0-s.c.y/max(1e-12,saturation(s,t,false,activity)));
    let evaporate=max(0.0,t+8.0)*0.0001*dry*dt+max(0.0,t-boiling)*c/(2475.0-2.18*boiling);
    let amount=min(s.b.x,min(evaporate,max(0.0,(t-tf)*c/(2475.0-2.18*tf))));
    s.b.x-=amount;s.c.y+=amount;
    t=(c*t-amount*(2257.0+2.18*100.0))/capacity(s);c=capacity(s);
  }
  if(params.wind.y<0.5&&s.b.y>0&&t<=tf+.3){let dry=max(0.0,1.0-s.c.y/max(1e-12,saturation(s,t,true,1.0)));let before=s.b.y;let requested=min(before,min(before*dry*dt*.002,max(0.0,(t+100.0)*c/2819.0)));s.b.y-=requested;let amount=before-s.b.y;s.c.y+=amount;t=(c*t-amount*2809.0)/capacity(s);c=capacity(s);}
  if(params.wind.y<0.5){
  let airTemperature=t-12.0;let airIce=airTemperature< -12.001;let cloudMass=s.cloud.x+s.cloud.y;
  let iceShare=select(select(0.0,1.0,airIce),s.cloud.y/max(1e-8,cloudMass),cloudMass>1e-8);
  let airSaturation=saturation(s,airTemperature,false,1.0)*(1.0-iceShare)+saturation(s,airTemperature,true,1.0)*iceShare;
  let excess=s.c.y-airSaturation;let latent=2475.0;
  if(excess>0 && airTemperature<boiling-5.0){
    let amount=min(s.c.y,excess*(1.0-exp(-dt*.4)));let before=s.c.y;s.c.y-=amount;
    if(airIce){s.cloud.y+=amount;}else{s.cloud.x+=amount;}
    condensed=before-s.c.y;t=(c*t+amount*(latent+select(0.0,334.0,airIce)))/capacity(s);c=capacity(s);
  }else if(excess<0){
    let cloud=s.cloud.x+s.cloud.y;let amount=min(cloud,min(-excess*(1.0-exp(-dt*.2)),max(0.0,(t+100.0)*c/(latent+334.0))));
    if(amount>0){let ice=min(s.cloud.y,amount*s.cloud.y/max(.00000001,cloud));let water=min(s.cloud.x,max(0.0,amount-ice));let evaporated=water+ice;s.cloud.x-=water;s.cloud.y-=ice;s.c.y+=evaporated;t=(c*t-evaporated*latent-ice*334.0)/capacity(s);c=capacity(s);}
  }
  if(t-12.0< -12.0 && s.cloud.x>0){let amount=min(s.cloud.x,min(-t*c/334.0,s.cloud.x*dt*.08));s.cloud.x-=amount;s.cloud.y+=amount;t=(c*t+amount*334.0)/capacity(s);c=capacity(s);}
  if(t-12.0>0 && s.cloud.y>0){let amount=min(s.cloud.y,min((t-12.0)*c/(334.0+2.08*12.0),s.cloud.y*dt*.15));s.cloud.y-=amount;s.cloud.x+=amount;t=(c*t-amount*334.0)/capacity(s);c=capacity(s);}
  }
  let latent=2475.0;
  let rain=max(0.0,s.cloud.x-0.18)*(1.0-exp(-dt*0.22*sqrt(params.sun.w)));
  let snow=max(0.0,s.cloud.y-0.10)*(1.0-exp(-dt*0.12*sqrt(params.sun.w)));
  s.cloud.x-=rain;s.cloud.y-=snow;
  let dry=max(0.0,1.0-s.c.y/max(1e-12,saturation(s,t,false,1.0)));let returning=min(0.85,dry*max(0.0,t+10.0)/80.0)*(rain+snow);
  s.c.y+=returning;let reaching=rain+snow-returning;let iceBeforeRain=s.b.y;let groundIce=t<freezing(s.b.x+rain+snow,s.b.w);
  if(groundIce){s.b.y+=reaching;}else{s.b.x+=reaching;}
  let sourcePhase=-snow*334.0;let destinationPhase=returning*latent-select(0.0,reaching*334.0,groundIce);
  t=(c*t+sourcePhase-destinationPhase)/capacity(s);c=capacity(s);
  if(s.a.y>0.0001 && s.b.x/max(.1,s.a.y)<0.008 && t>=850){
    s.c.z+=dt;
    if(s.c.z>=30){let heat=c*t;s.a.z+=s.a.y;s.a.y=0.0;s.c.z=0.0;c=capacity(s);t=heat/c;}
  }
  if(t>1700 && s.a.x>0){
    let amount=min(s.a.x,min(dt*(t-1700.0)*0.005,c*(t-1700.0)/150.0));
    s.a.x-=amount;s.c.w+=amount;t-=amount*150.0/c;
  }
  if(t>1400 && s.a.w>0){let amount=min(s.a.w,dt*3.0*min(1.0,(t-1400.0)/200.0));s.a.w-=amount;s.c.w+=amount;}
  if(t<1400 && s.c.w>0){
    let amount=min(s.c.w,dt*3.0);s.c.w-=amount;s.a.w+=amount;
  }
  s.c.x=t;s=equilibrateWater(s);t=s.c.x;c=capacity(s);
  snowReaching=min(reaching,max(0.0,s.b.y-iceBeforeRain));rainReaching=reaching-snowReaching;
  s.c.x=t;s=drownConsumers(s);let suitability=plantHabitat(s,light);let herbHabitat=consumerHabitat(s,false);let carnHabitat=consumerHabitat(s,true);
  let growth=min(s.cloud.z,s.cloud.w*.085*suitability*dt);s.cloud.z-=growth;s.cloud.w+=growth;
  let grazing=min(s.cloud.w,s.life.x*.12*herbHabitat*dt);let hunting=min(s.life.x,s.life.y*.075*carnHabitat*dt);
  s.cloud.w-=grazing;s.life.x+=grazing*.36-hunting;s.life.y+=hunting*.3;s.cloud.z+=grazing*.64+hunting*.7;
  let pd=min(s.cloud.w,s.cloud.w*(.0015+(1.0-suitability)*.009)*dt);
  let hd=min(s.life.x,s.life.x*(.003+select(0.0,.018,grazing<s.life.x*.015*dt)+(1.0-herbHabitat)*.12)*dt);
  let cd=min(s.life.y,s.life.y*(.002+select(0.0,.012,hunting<s.life.y*.008*dt)+(1.0-carnHabitat)*.1)*dt);
  s.cloud.z+=pd+hd+cd;s.cloud.w-=pd;s.life.x-=hd;s.life.y-=cd;
  s.c.x=clamp(t,-100.0,2500.0);
  numerical+=c*(s.c.x-t);
  let gases=vec4f(s.c.y,s.d.yzw);
  let lambda=max(0.0,params.sun.w)*9.81*1000000.0*vec4f(0.018015,0.028014,0.016043,0.04401)/(8.314462618*max(1.0,s.c.x+273.15));
  let rate=dt*0.15*(vec4f(1)+lambda)*exp(-lambda);
  let fraction=vec4f(lossFraction(rate.x),lossFraction(rate.y),lossFraction(rate.z),lossFraction(rate.w));
  let remaining=gases*(vec4f(1)-fraction);
  let removed=gases-remaining;let escapedEnergy=-dot(removed,vec4f(2,1.04,2.22,.85)*s.c.x+vec4f(2475,0,0,0));
  changes[i]=Changes(removed,vec4f(condensed,rainReaching,snowReaching,0),vec4f(environmentHeat,tools,escapedEnergy,numerical));s.c.y=remaining.x;s.d=vec4f(s.d.x,remaining.yzw);
  return s;
}

@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x;if(i>=u32(params.control.x)){return;}
  let original=prepared[i];var s=original;
  if(params.control.y<=0){output[i]=reaction(original,i);return;}
  var energy=capacity(original)*original.c.x;
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
    energy+=(incomingFlow.cloud.z*prepared[j].c.x-outgoingFlow.cloud.z*original.c.x)*.8;
    energy+=dot(incomingFlow.cloud.xy*prepared[j].c.x-outgoingFlow.cloud.xy*original.c.x,vec2f(4.18,2.1));
    let change=incoming-outgoing;
    s.b.x+=change.x;s.a.x+=change.y;s.a.y+=change.z;s.b.w+=change.w;
    energy+=dot(incoming*prepared[j].c.x-outgoing*original.c.x,vec4f(4.18,0.8,1.0,0.85));
    let distance=length(geometry[i].xyz-geometry[j].xyz)*4.8/.024;let spatial=edgeScale(distance);
    let here=plantHabitat(original,surfaceLight(original,i));
    let there=plantHabitat(prepared[j],surfaceLight(prepared[j],j));
    let biomass=(prepared[j].cloud.w*here-original.cloud.w*there)*min(dt*spatial*.004,1.0/6.0);
    s.cloud.w+=biomass;
    energy+=biomass*select(original.c.x,prepared[j].c.x,biomass>=0.0);
    let ka=conductivity(original);let kb=conductivity(prepared[j]);
    conduction+=(prepared[j].c.x-original.c.x)*min(dt*2.0*ka*kb/max(1e-8,ka+kb)*spatial,min(capacity(original),capacity(prepared[j]))/12.0);
    let diff=(prepared[j].c.y-original.c.y)*min(dt*.28*spatial,1.0/6.0);
    s.c.y+=diff;
    energy+=diff*2.0*select(original.c.x,prepared[j].c.x,diff>=0.0);
    let gases=(prepared[j].d.yzw-original.d.yzw)*min(dt*.6*spatial,1.0/6.0);
    s.d=vec4f(s.d.x,s.d.yzw+gases);
    energy+=dot(gases*select(vec3f(original.c.x),vec3f(prepared[j].c.x),gases>=vec3f(0)),vec3f(1.04,2.22,0.85));
  }
  s.c.x=(energy+conduction)/capacity(s);
  s.c.z=select(0.0,max(0.0,firingDose)/max(.00000001,s.a.y),s.a.y>.00000001);
  output[i]=reaction(s,i);
}
