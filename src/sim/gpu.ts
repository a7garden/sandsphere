import {WeatherClimate} from './weatherClimate';
import shader from './physics.wgsl?raw';
import { COMMAND_STRIDE, gravityMultiplier, type Environment, type Solver,applyCommand,enthalpy } from './model';
import { NEIGHBORS, type SphereGrid } from './sphere';
import {physicsSteps} from './clock';

/** GPU storage is authoritative; a compact readback updates the surface renderer. */
export class GpuSolver implements Solver {
  readonly backend='WebGPU';
  readonly climate:WeatherClimate;
  escapeCells:Float32Array;
  condensedCells:Float32Array;
  precipitatedCells:Float32Array;
  energyChanges:Float32Array;
  private device:GPUDevice;
  private buffers:GPUBuffer[];
  private staging:GPUBuffer;
  private layout:GPUBindGroupLayout;
  private pipelines:GPUComputePipeline[];
  private groups:GPUBindGroup[];
  private parity=0;
  private loss:Error|null=null;
  private stopped=false;
  private constructor(readonly grid:SphereGrid,public state:Float32Array,device:GPUDevice,
    buffers:GPUBuffer[],staging:GPUBuffer,layout:GPUBindGroupLayout,pipelines:GPUComputePipeline[]) {
    this.climate=new WeatherClimate(grid);
    this.device=device;this.buffers=buffers;this.staging=staging;this.layout=layout;this.pipelines=pipelines;
    this.escapeCells=new Float32Array(grid.count*4);
    this.condensedCells=new Float32Array(grid.count);this.precipitatedCells=new Float32Array(grid.count*2);
    this.energyChanges=new Float32Array(grid.count*4);
    this.groups=[this.bind(false),this.bind(true)];
    device.lost.then(info=>{if(!this.stopped)this.loss=new Error(info.message||'GPU 연결이 종료됐습니다.');});
  }
  static async create(grid:SphereGrid,state:Float32Array) {
    if(!navigator.gpu) return null;
    const adapter=await navigator.gpu.requestAdapter();
    if(!adapter) return null;
    const device=await adapter.requestDevice();
    const module=device.createShaderModule({label:'Sandsphere conservative transport',code:shader});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length) {device.destroy();throw new Error(errors.map(m=>m.lineNum+': '+m.message).join('\n'));}
    const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
    const buffer=(label:string,size:number,usage=storage)=>device.createBuffer({label,size,usage});
    const buffers=[
      buffer('state A',state.byteLength),buffer('prepared state',state.byteLength),
      buffer('edge fluxes',grid.count*NEIGHBORS*8*4),buffer('state B',state.byteLength),
      buffer('spherical geometry',grid.geometry.byteLength),buffer('neighbors',grid.neighbors.byteLength),
      buffer('queued brush commands',grid.count*COMMAND_STRIDE*4),
      buffer('environment',48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),
      buffer('mass and energy transfers',grid.count*12*4),
    ];
    device.queue.writeBuffer(buffers[0],0,state as Float32Array<ArrayBuffer>);
    device.queue.writeBuffer(buffers[4],0,grid.geometry as Float32Array<ArrayBuffer>);
    device.queue.writeBuffer(buffers[5],0,grid.neighbors as Uint32Array<ArrayBuffer>);
    const entries:GPUBindGroupLayoutEntry[]=buffers.map((_,binding)=>({
      binding,visibility:GPUShaderStage.COMPUTE,
      buffer:{type:binding===7?'uniform':[0,4,5,6].includes(binding)?'read-only-storage':'storage'},
    }));
    const layout=device.createBindGroupLayout({entries});
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
    const pipelines=await Promise.all(['apply','flux','advance'].map(entryPoint =>
      device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}})));
    const staging=buffer('surface and transfers readback',state.byteLength+grid.count*12*4,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    return new GpuSolver(grid,state,device,buffers,staging,layout,pipelines);
  }
  private bind(swapped:boolean) {
    const entries=this.buffers.map((_,binding)=>({
      binding,resource:{buffer:this.buffers[swapped&&binding===0?3:swapped&&binding===3?0:binding]},
    }));
    return this.device.createBindGroup({layout:this.layout,entries});
  }
  replace(state:Float32Array) {
    this.state=new Float32Array(state);
    this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);
    this.device.queue.writeBuffer(this.buffers[this.parity===0?0:3],0,this.state as Float32Array<ArrayBuffer>);
  }
  async step(dt:number,commands:Float32Array,environment:Environment) {
    const before=this.state,parity=this.parity,climate=this.climate.checkpoint();
    this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);
    if(dt<=0&&!commands.some(v=>v!==0))return;
    const steps=physicsSteps(dt),empty=new Float32Array(commands.length);
    try{for(let n=0;n<steps.length;n++)await this.stepSingle(steps[n],n===0?commands:empty,environment);}
    catch(error){this.state=before;this.parity=parity;this.climate.restoreCheckpoint(climate);this.escapeCells.fill(0);this.condensedCells.fill(0);this.precipitatedCells.fill(0);this.energyChanges.fill(0);throw error;}
  }
  private async stepSingle(dt:number,commands:Float32Array,environment:Environment) {
    if(this.loss) throw this.loss;
    const params=new Float32Array([this.grid.count,dt,environment.ambient,environment.sunlight,...environment.sun,gravityMultiplier(environment),environment.rotationRate??0,environment.climate?1:0,0,0]);
    let kernelCommands=commands;
    if(environment.climate){
      const surface=this.state.slice();this.climate.prepareSurface(surface,environment);
      for(let i=0;i<this.grid.count;i++){const before=enthalpy(surface,i);applyCommand(surface,i,commands);this.energyChanges[i*4+1]+=enthalpy(surface,i)-before;}
      this.climate.surfaceSupplies(surface,commands,COMMAND_STRIDE,this.energyChanges);
      this.device.queue.writeBuffer(this.buffers[this.parity===0?0:3],0,surface as Float32Array<ArrayBuffer>);
      kernelCommands=new Float32Array(commands.length);
    }
    this.device.queue.writeBuffer(this.buffers[6],0,kernelCommands as Float32Array<ArrayBuffer>);
    this.device.queue.writeBuffer(this.buffers[7],0,params);
    const encoder=this.device.createCommandEncoder();
    for(const pipeline of this.pipelines) {
      const pass=encoder.beginComputePass();
      pass.setPipeline(pipeline);pass.setBindGroup(0,this.groups[this.parity]);
      pass.dispatchWorkgroups(Math.ceil(this.grid.count/64));pass.end();
    }
    const out=this.buffers[this.parity===0?3:0];
    encoder.copyBufferToBuffer(out,0,this.staging,0,this.state.byteLength);
    encoder.copyBufferToBuffer(this.buffers[8],0,this.staging,this.state.byteLength,this.grid.count*12*4);
    this.device.queue.submit([encoder.finish()]);
    await this.staging.mapAsync(GPUMapMode.READ);
    const data=new Float32Array(this.staging.getMappedRange());
    // A failed step must leave the last committed CPU snapshot untouched:
    // the fallback replays this step's command batch exactly once.
    if(this.loss){this.staging.unmap();throw this.loss;}
    const changes=data.subarray(this.state.length);
    for(let i=0;i<this.grid.count;i++){for(let k=0;k<4;k++){this.escapeCells[i*4+k]+=changes[i*12+k];this.energyChanges[i*4+k]+=changes[i*12+8+k];}this.condensedCells[i]+=changes[i*12+4];this.precipitatedCells[i*2]+=changes[i*12+5];this.precipitatedCells[i*2+1]+=changes[i*12+6];}
    this.state=data.slice(0,this.state.length);
    this.staging.unmap();
    if(environment.climate){this.climate.step(this.state,dt,environment,this.energyChanges,this.condensedCells,this.precipitatedCells,this.escapeCells);this.device.queue.writeBuffer(out,0,this.state as Float32Array<ArrayBuffer>);}
    this.parity=1-this.parity;
  }
  dispose() {
    this.stopped=true;
    for(const b of this.buffers)b.destroy();
    this.staging.destroy();this.device.destroy();
  }
}
