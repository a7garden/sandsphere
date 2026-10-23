// Optional maintainer tool. npm build consumes the checked-in binary and never
// invokes a compiler. No download/install is performed by this script.
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),source=join(root,'scripts/spectral-optics.c'),output=join(root,'src/sim/data/spectral-optics-simd.wasm'),manifest=join(root,'src/sim/data/spectral-optics-simd.json');
const clang=process.env.SPECTRAL_WASM_CLANG??'clang';
let linker=process.env.SPECTRAL_WASM_LD,linkerEnv=process.env;
if(!linker){
 const rustRoot=execFileSync('rustc',['--print','sysroot'],{encoding:'utf8'}).trim(),host=execFileSync('rustc',['-vV'],{encoding:'utf8'}).match(/^host: (.+)$/m)?.[1];
 linker=join(rustRoot,'lib','rustlib',host,'bin','rust-lld');linkerEnv={...process.env,DYLD_LIBRARY_PATH:join(rustRoot,'lib')};
}
if(!existsSync(linker))throw new Error('No local wasm linker. Set SPECTRAL_WASM_LD; no installation was attempted.');
const flags=['--target=wasm32','-O3','-ffp-contract=off','-fno-fast-math','-fno-vectorize','-fno-slp-vectorize','-fno-builtin','-nostdlib','-msimd128','-DUSE_SIMD=1'];
const directory=mkdtempSync(join(tmpdir(),'sandsphere-spectral-wasm-'));
try{
 const object=join(directory,'spectral.o'),built=join(directory,'spectral-optics-simd.wasm');execFileSync(clang,[...flags,'-c',source,'-o',object],{stdio:'inherit'});
 const flavor=linker.endsWith('rust-lld')?['-flavor','wasm']:[],linkFlags=['--no-entry','--export=optics','--export=__heap_base','--export-memory','--stack-first','-z','stack-size=65536','--initial-memory=131072'];
 execFileSync(linker,[...flavor,...linkFlags,object,'-o',built],{stdio:'inherit',env:linkerEnv});const bytes=readFileSync(built);
 if(!WebAssembly.validate(bytes))throw new Error('Built Float64 SIMD binary is unsupported by this Node runtime');
 const sha256=value=>createHash('sha256').update(value).digest('hex');
 const metadata={schema:1,source:'scripts/spectral-optics.c',sourceSha256:sha256(readFileSync(source)),binary:'spectral-optics-simd.wasm',binarySha256:sha256(bytes),binaryBytes:bytes.length,compiler:execFileSync(clang,['--version'],{encoding:'utf8'}).trim(),linker:execFileSync(linker,[...flavor,'--version'],{encoding:'utf8',env:linkerEnv}).trim(),compileFlags:flags,linkFlags,precision:'IEEE754 Float64, strict f64x2 SIMD; no relaxed SIMD/FMA/reassociation; gas accumulation j=0..7'};
 writeFileSync(output,bytes);writeFileSync(manifest,JSON.stringify(metadata,null,2)+'\n');console.log(JSON.stringify(metadata,null,2));
}finally{rmSync(directory,{recursive:true,force:true});}
