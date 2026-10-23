import {afterEach,expect,it,vi} from 'vitest';
import {boundedWebGPU} from '../src/render/rendererBoot';
const deferred=()=>{let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
afterEach(()=>vi.useRealTimers());

it('retains a renderer that initializes within the deadline and clears its timer',async()=>{
 vi.useFakeTimers();const engine={},dispose=vi.fn(),initialize=vi.fn(async()=>{});
 expect(await boundedWebGPU(async()=>true,()=>engine,initialize,dispose)).toBe(engine);
 expect(initialize).toHaveBeenCalledOnce();expect(dispose).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});

it('falls back after three seconds and retries cleanup when a slow device finally initializes',async()=>{
 vi.useFakeTimers();const device=deferred(),engine={ready:false,released:false},compiler=vi.fn(async()=>{}),dispose=vi.fn(()=>{if(!engine.ready)throw new Error('managers not initialized');engine.released=true;});
 const result=boundedWebGPU(async()=>true,()=>engine,async (value,abandoned)=>{await device.promise;value.ready=true;if(!abandoned())await compiler();},dispose).catch(error=>error);
 await vi.advanceTimersByTimeAsync(3000);
 expect(await result).toBeInstanceOf(Error);expect(dispose).toHaveBeenCalledOnce();
 device.resolve();await vi.advanceTimersByTimeAsync(0);
 expect(dispose).toHaveBeenCalledTimes(2);expect(engine.released).toBe(true);expect(compiler).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});

it('releases an initialized device when deferred compiler loading stalls and handles its late rejection',async()=>{
 vi.useFakeTimers();const compiler=deferred(),engine={},dispose=vi.fn();
 const result=boundedWebGPU(async()=>true,()=>engine,async()=>{await compiler.promise;},dispose).catch(error=>error);
 await vi.advanceTimersByTimeAsync(3000);expect(await result).toBeInstanceOf(Error);expect(dispose).toHaveBeenCalledOnce();
 compiler.reject(new Error('compiler download failed'));await vi.advanceTimersByTimeAsync(0);expect(dispose).toHaveBeenCalledTimes(2);
});

it('never constructs a late renderer after an abandoned adapter probe',async()=>{
 vi.useFakeTimers();let resolve!:(supported:boolean)=>void;const probe=new Promise<boolean>(yes=>resolve=yes),create=vi.fn(()=>({})),dispose=vi.fn();
 const result=boundedWebGPU(()=>probe,create,async()=>{},dispose).catch(error=>error);
 await vi.advanceTimersByTimeAsync(3000);expect(await result).toBeInstanceOf(Error);resolve(true);await vi.advanceTimersByTimeAsync(0);
 expect(create).not.toHaveBeenCalled();expect(dispose).not.toHaveBeenCalled();
});

it('does not create WebGPU resources when unsupported and cleans up a rejected attempt',async()=>{
 const create=vi.fn(()=>({})),dispose=vi.fn();expect(await boundedWebGPU(async()=>false,create,async()=>{},dispose)).toBeNull();expect(create).not.toHaveBeenCalled();
 await expect(boundedWebGPU(async()=>true,create,async()=>{throw new Error('device lost');},dispose)).rejects.toThrow('device lost');expect(dispose).toHaveBeenCalledOnce();
});
