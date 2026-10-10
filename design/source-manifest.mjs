import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
export async function sourceManifest(additionalFiles = []) {
  const files = [...new Set(['src/sim/model.ts', 'src/sim/sphere.ts', 'src/sim/ecology.ts', 'src/sim/gases.ts', 'src/sim/clouds.ts', 'src/sim/physics.wgsl', 'src/sim/progress.ts', 'src/sim/system.ts', 'src/sim/session.ts', 'src/sim/gpu.ts', 'src/render/planet.ts', 'src/render/precipitationLayer.ts', 'src/main.ts', ...additionalFiles])];
  const hashes = {};
  for (const file of files) hashes[file] = createHash('sha256').update(await readFile(new URL('../' + file, import.meta.url))).digest('hex');
  return { generatedAt: new Date().toISOString(), backend: 'CPU', sourceSha256: hashes };
}
