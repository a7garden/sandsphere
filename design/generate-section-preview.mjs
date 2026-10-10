import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { root, sourceManifest } from './source-manifest.mjs';

// A separate reproducible example; never reads browser storage or player saves.
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
  const M = await server.ssrLoadModule('/src/sim/model.ts');
  const S = await server.ssrLoadModule('/src/sim/sphere.ts');
  const grid = S.createSphere(4);
  const unit = v => v.map(x => x / Math.hypot(...v));
  const dot = (a, b) => a.reduce((sum, x, k) => sum + x * b[k], 0);
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));
  const direction = i => Array.from(grid.directions.slice(i * 3, i * 3 + 3));
  let minEdge = Infinity;
  for (let i = 0; i < grid.count; i++) for (let k = 0; k < S.NEIGHBORS; k++) {
    const j = grid.neighbors[i * S.NEIGHBORS + k];
    if (j !== S.INVALID) minEdge = Math.min(minEdge, angle(direction(i), direction(j)));
  }
  // Exhaustive nearest search gives deterministic cell-id tie breaking for preview.
  const nearest = d => {
    let best = 0, score = -Infinity;
    for (let i = 0; i < grid.count; i++) {
      const value = dot(direction(i), d);
      if (value > score + 1e-12) { score = value; best = i; }
    }
    return best;
  };
  const specs = [
    ['해안 횡단', [-.9, .15, .4], [.9, .15, .4]],
    ['북쪽 고위도', [-.8, .1, .55], [.2, .9, .3]],
    ['뒷면 횡단', [-.3, .25, -.92], [.65, .2, -.74]],
  ];
  const paths = specs.map(([name, av, bv]) => {
    const a = unit(av), b = unit(bv), theta = angle(a, b);
    const interpolate = t => a.map((x, k) => (Math.sin((1 - t) * theta) * x + Math.sin(t * theta) * b[k]) / Math.sin(theta));
    let segments;
    let count = Math.ceil(theta / (minEdge / 4));
    for (let attempt = 0; attempt < 6; attempt++, count *= 2) {
      segments = [];
      for (let k = 0; k <= count; k++) {
        const cellId = nearest(interpolate(k / count));
        const lo = Math.max(0, (k - .5) / count), hi = Math.min(1, (k + .5) / count);
        if (segments.at(-1)?.cellId === cellId) segments.at(-1).to = hi * theta * 180 / Math.PI;
        else segments.push({ cellId, from: lo * theta * 180 / Math.PI, to: hi * theta * 180 / Math.PI });
      }
      const adjacent = segments.every((s, k) => k === 0 || Array.from(grid.neighbors.slice(s.cellId * 6, s.cellId * 6 + 6)).includes(segments[k - 1].cellId));
      if (adjacent) break;
      if (attempt === 5) throw new Error('Non-adjacent path transition: ' + name);
    }
    return { name, a, b, degrees: theta * 180 / Math.PI, segments,
      points: Array.from({ length: 65 }, (_, k) => interpolate(k / 64)) };
  });
  const initial = M.seedWorld(grid, 'coast');
  for (let i = 0; i < grid.count; i++) initial[i * M.STRIDE + M.F.temperature] = 16 * grid.directions[i * 3 + 1] - 4;
  const environment = { ambient: -8, sunlight: .45, sun: [-.65, .72, .35], gravity: 1 };
  const solver = new M.CpuSolver(grid, initial);
  const commands = new Float32Array(grid.count * M.COMMAND_STRIDE);
  const ids = [...new Set(paths.flatMap(p => p.segments.map(s => s.cellId)))];
  const targets = [0, 60, 120, 240, 480, 960];
  const frames = [];
  let tick = 0;
  for (const target of targets) {
    while (tick < target) { solver.advance(1 / 30, commands, environment); tick++; }
    const cells = {};
    for (const i of ids) {
      const p = i * M.STRIDE, fields = Object.fromEntries(Object.entries(M.F).map(([key, offset]) => [key, solver.state[p + offset]]));
      const solidTop = M.solidHeight(solver.state, i, grid);
      cells[i] = { cellId: i, direction: direction(i), baseHeight: grid.geometry[i * 4 + 3], solidTop,
        waterHead: solidTop + fields.water, heldWater: Math.min(fields.water, Math.min(1.2, fields.soil * .12)), fields };
    }
    frames.push({ tick, time: tick / 30, cells });
  }
  const payload = { ...await sourceManifest(), modelRevision: 'existing-0.3', gridCount: grid.count,
    initialCondition: 'seedWorld(coast); representative temperature = 16 * local y - 4 C; no further commands',
    environment, dt: 1 / 30, paths, frames };
  const json = JSON.stringify(payload);
  await writeFile(new URL('./section-preview.json', import.meta.url), JSON.stringify(payload, null, 2) + '\n');
  const htmlPath = new URL('./science-section.html', import.meta.url);
  const html = await readFile(htmlPath, 'utf8');
  const marker = /(<script id="preview-data" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!marker.test(html)) throw new Error('Missing preview-data marker');
  await writeFile(htmlPath, html.replace(marker, (_, start, end) => start + json.replaceAll('<', '\\u003c') + end));
  console.log(JSON.stringify({ cells: grid.count, sampled: ids.length, pathCells: paths.map(p => p.segments.length), frames: targets.length, seconds: targets.at(-1) / 30 }));
} finally { await server.close(); }
