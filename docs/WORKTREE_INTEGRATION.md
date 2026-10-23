# Worktree integration audit — 2026-10-18

The canonical checkout is `/Users/garden/Workspace/Projects/sandsphere`, on
`codex/animal-ai` at `02d53d7bb7111ed2a858599dd296489db9246417`. This audit preserves
its existing uncommitted simulation, rendering, UI, tests, and documentation work.

## Inventory and decision

`git worktree list --porcelain` lists exactly two project worktrees:

| Checkout | HEAD | Result |
| --- | --- | --- |
| Canonical checkout | `02d53d7` | Current integration target; existing uncommitted work preserved |
| `/Users/garden/Workspace/Projects/wt/sandsphere-glass-ui` | detached `f6fbc78` | Base commit and glass UI changes already integrated; no source merge needed |

`f6fbc78d04671b2df9bd64b3d856a8f5a34b4105` is an ancestor of the canonical HEAD.
There are 14 subsequent canonical commits and no commits exclusive to the glass
worktree. Its unfinished-looking Git status represents an old copy of changes
that were incorporated in `9a7dffe` and then refined in the canonical checkout.

The integration plan was to preserve the source worktree, map every dirty file
to its canonical counterpart, and add only behavior absent from the canonical
checkout. That comparison found no missing implementation. No source file was
overwritten, cherry-picked, reset, committed, or removed. The old light/dark panel
switch is preserved in the backup as historical work; restoring it would undo
the committed dark-only interface choice.

## Per-file provenance

| Source worktree path | Evidence in the canonical checkout | Disposition |
| --- | --- | --- |
| `.hallmark/log.json` | The added `Floating orbital workbench` entry is deep-equal to the entry already committed in `9a7dffe`; later canonical entries remain present | Already integrated |
| `index.html` | Dark root theme and black theme color retained; canonical additionally has `viewport-fit=cover` | Already integrated and subsequently refined |
| `src/main.ts` | Glass stylesheet import, parameterless black-space renderer call, removed sky choice and removed sky help entry retained; canonical now explicitly uses the dark interface and has newer campaign, planet, ecology, and thermal work | Already integrated; temporary theme toggle superseded |
| `src/render/planet.ts` | Black clear color, parameterless `setSpace()`, stars and all three black-space render adapters retained; later rendering changes remain present | Already integrated and subsequently refined |
| `src/ui/appChrome.ts` | Sky selector removed; panel brightness selector subsequently removed with the canonical dark-only interface; language, onboarding, and account controls retained | Already integrated; temporary theme toggle superseded |
| `tokens.css` | The complete 30-line restrained-glass token addition is a verbatim contiguous substring of the canonical file; later control and layout tokens remain present | Already integrated and subsequently refined |
| `src/ui/glassWorkbench.css` (untracked in old worktree) | Byte-identical to the canonical tracked file and to its content in `9a7dffe`; SHA-256 `d55ecc6bb054a3f4e844fdaae8e33f62b9a7d7a3d347f05d7662633af379230b` | Already integrated |
| `node_modules` (untracked symlink) | Points to `/Users/garden/Workspace/Projects/sandsphere/node_modules` | Dependency link; contains no independent project source |

The glass worktree remains intact at its original path. Its dirty status is not
treated as proof of missing work, and this audit does not authorize its removal.

## Preserved evidence

Artifacts live under `artifacts/stabilization/worktree-integration/` (ignored by
Git):

- `glass-ui-originals/`: all six modified tracked files plus the untracked glass
  stylesheet, copied with their original bytes.
- `glass-ui-base/`: each modified tracked file as stored in the worktree's HEAD.
- `canonical-observed/`: the seven canonical counterparts as observed before
  this audit made any documentation changes.
- `glass-ui-tracked.patch`: full binary-capable patch of the source worktree.
- `worktrees.txt`, `glass-ui-status.txt`, `canonical-status.txt`: Git inventory
  and state receipts.
- `audit.json`: SHA-256 for each source/canonical pair, ancestry checks, exact
  containment checks, and the no-source-change decision.

The parent stabilization backup is
`artifacts/stabilization/pre-integration-source.tgz`; its tracked patch is
`artifacts/stabilization/pre-integration-tracked.patch`.

## Validation scope

All structural audit assertions in `audit.json` passed. This includes ancestor
containment, zero exclusive source commits, exact stylesheet equality, exact
token-block containment, matching Hallmark entry, and the current black-space
renderer/UI bindings. The focused command
`npx vitest run tests/campaign-ui.test.ts tests/render-physics.test.ts tests/section-tools.test.ts --maxWorkers=1 --testTimeout=20000`
passed all 10 tests in 3 files against the working tree observed during this
audit. No source changes were needed, and this audit makes no new visual or
performance claim. The broader stabilization work owns the final test/build and
actual-game validation.
