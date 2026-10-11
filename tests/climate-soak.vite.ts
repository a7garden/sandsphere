import {defineConfig} from 'vite';
import {resolve} from 'node:path';

/** Build an isolated real-engine fixture without live source reloads. */
export default defineConfig({build:{target:'es2022',outDir:'artifacts/climate-soak-browser',rollupOptions:{input:{soak:resolve('tests/climate-soak-lab.html')}}}});
