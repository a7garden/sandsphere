import {CpuSolver} from './model';
import type {SphereGrid} from './sphere';

/** Compatibility entry point for callers probing the former WebGPU backend.
 * Its Float32 dispatch/readback was discarded before the authoritative Float64
 * CPU step. Until a GPU implementation owns an accepted physical result, use
 * the CPU/Worker fallback without allocating a device or advertising WebGPU. */
export class GpuSolver extends CpuSolver {
 static async create(_grid:SphereGrid,_state:Float32Array):Promise<GpuSolver|null>{return null;}
}
