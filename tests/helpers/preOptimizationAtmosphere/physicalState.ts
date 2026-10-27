// @ts-nocheck -- immutable pre-optimization fixture; production nominal types may evolve.
// Only import paths differ; normalize them to verify the original captured source SHA-256.
/** Float64 is the host's physical inventory. Float32 remains a compatible
 * public projection for rendering, GPU buffers and historical saves. */
export type PhysicalState=Float32Array|Float64Array;

/** Physical stocks retain Float64 low bits, but must still have a finite
 * Float32 projection for the public state, GPU buffers and save mirrors.
 * This is a representation boundary, not a mass-removal or saturation rule. */
export function validStateScalar(value:number){return Number.isFinite(value)&&Number.isFinite(Math.fround(value));}
export function validInventoryAmount(value:number){return value>=0&&validStateScalar(value);}
export function assertInventoryAmount(value:number){if(!validInventoryAmount(value))throw new Error('물질 재고가 유한한 상태 표현 범위를 벗어났습니다.');}

/** Reject an unrepresentable transaction before publishing it; never clip its stocks or ledger. */
export function assertFiniteStepOutputs(...outputs:Float32Array[]){
  for(const output of outputs)for(const value of output)if(!Number.isFinite(value))throw new Error('시뮬레이션 단계가 유한한 상태·수지 표현 범위를 벗어났습니다.');
}
