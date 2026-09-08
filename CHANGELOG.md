# Changelog

All notable changes to this monorepo are documented here. Each public package
within `packages/*` follows [Semantic Versioning](https://semver.org).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Maintenance convention.** Every substantive change adds an entry under
> `## Unreleased`, grouped by `Added` / `Changed` / `Fixed` / `Removed`. Prefix
> the bullet with the affected **package(s)** and state the **why**, not just the
> what. For **kernel-behaviour** changes (anything plugins observe), note that it
> is a *cascade* and cite the canonical commit short-sha; the two plugins must
> record the matching submodule bump in their own CHANGELOGs. See
> [`AGENTS.md`](./AGENTS.md) and
> [`docs/architecture/contracts.md`](./docs/architecture/contracts.md#ssot--the-kernel-cascade).

## Unreleased

### Removed

- **`node-runtime-react` — retire `asset_grid` as a core port type (cascade).**
  Removes the stale type from the core colour, compatibility, and data-type
  legend tables so only genuinely common port types remain in the kernel.
- **`node-runtime` — remove the retired `autoTextureBindings` engine behavior
  hook.** With the scene `texture_bind` battery gone, the executor no longer
  forwards `_asset_bindings` sidecar outputs and the loader drops that legacy
  `engineBehavior` value.

### Added

- **Multi-project management: inline `<ProjectPanel>`, cross-client active-project
  sync, and a per-agent exclusive lock (cascade).** Three additions consumed by
  both plugins' left side pane + agent API:
  - **`node-runtime-react` — `<ProjectPanel>`** (`editor/components/chrome/ProjectPanel.tsx`),
    an inline (non-modal) project manager driven by `useProjectStore`: cards with
    switch / `+ New` / delete. Its sub-views (`ProjectCard`, `NewProjectWizard`,
    `DeleteProjectDialog`) were extracted to `projectViews.tsx` and are now shared
    with the existing `ProjectsDialog` (single implementation). *Why:* the project
    UI moves from a canvas top-right modal into the left pane; building it per-plugin
    would duplicate it.
  - **Cross-client live active-project sync.** New `project:activated` runtime event
    (`subscriptions.ts` `WorkspaceEvent`; `event-bus.ts` `channelOf` maps `project:`
    → the `graph` channel to match the client transport demux). `WsAdapter` routes
    it; `projectStore.subscribeProjectActivation()` runs the light half of
    `switchProject` (load + reset, NO re-`activateProject` → no feedback loop) so a
    switch in one client (sibling iframe / agent tool) follows live in every other.
    Wired at Editor boot beside `subscribeLiveSync`. *Why:* the left "projects" pane
    and the center editor are separate iframes; switching in one must update the other.
  - **`ProjectRegistry` per-agent exclusive lock** (`project-registry.ts`):
    `CallerIdentity` + `acquireProjectLock` / `releaseProjectLock` /
    `checkMutationAccess` / `getProjectLock`. Open-then-operate semantics — at most
    one agent per project, at most one project per agent; an agent must release
    before opening another; humans (`kind!=='ai'`) always bypass. In-memory
    (process-lifetime; a restart clears locks). `deleteProject` drops any lock on the
    removed project. *Why:* multiple agents share one backend's single active project;
    the lock prevents concurrent clobbering. The two plugins forward the caller via
    `x-forgeax-caller-*` headers and enforce at their route layer (kernel stays SSOT
    for lock state/logic).

- **`node-runtime-react` — debounced session persist + skippable exec persist
  (cascade; ports the editor half of upstream `7bccdc20`).**
  Adds `schedulePersistSession(reason?)` to the pipeline store: a 500ms-debounced
  best-effort persist for high-frequency layout/UI changes (node/frame drag-stop,
  panel/text resize, preview toggle, annotation/frame add/update/move/remove,
  group-port patch/move). `incrementalExecute(nodeId, fullExec?, { persist })`
  gains an optional `{ persist: false }` so callers that already persisted (drag
  end, group create/paste, relay create/restore, delete-downstream) skip the
  redundant op-persist round-trip. Why: collapse persist storms during drags and
  multi-step canvas edits. Reconciliation with our refactor: the legacy change
  also rewrote `persistSession` around a full-PUT `apiService.updatePipeline`
  helper and parallelized sequential group loading in `loadPipeline` — neither
  applies here because our store persists via op-diff (`enqueuePipelinePersist`,
  serialized by `_localMutationSeq`) and our `loadPipeline` pulls a single
  transport snapshot; only the debounce + `{persist}` *intent* was ported, layered
  on top of the existing op-persist queue (which already drops stale snapshots).
  Touches `stores/pipelineStore.ts` + canvas call-sites (`useCanvasSnap`,
  `useCanvasFrames`, `useCanvasDelete`, `useCanvasDrop`, `useCanvasGroup`,
  `useCanvasGroupView`, `useCtrlDragGhost`, `useCanvasCopyPaste`,
  `useCanvasRelayInteractions`, `TextPanelNode`, `GridPanelNode`, `JsonNode`,
  `NameListPanelNode`). The `7bccdc20` backend/geometry halves land in the
  3d-lowpoly plugin (plugin-only, see its CHANGELOG).

- **`node-runtime-react` — editor parity port from upstream `wb-scene` (cascade).**
  Ported a batch of upstream editor fixes/features faithfully onto the refactored
  kernel (single cascade; both plugins bump `external/` to the new canonical
  commit). Why: close the gap between the legacy implicit-list editor and our
  refactored canvas without regressing our splits.
  - `7c1206cd` — i18n: English `Preview Off` / `N/M Off` labels on `BatteryNode`
    preview status (`BatteryNode.tsx`).
  - `e0c567d7` — relay double-click delete now restores **all** forks of a
    one-input/multi-output relay, not just the first (`useCanvasRelayInteractions.ts`).
  - `09388e3f` — relay node is a capsule sized to its in/out labels;
    `RELAY_NODE_SIZE` → `RELAY_NODE_WIDTH` + `RELAY_NODE_HEIGHT` across the canvas
    hooks/components + smoke test.
  - `b2beda9e` — `BatteryNode` preview-disabled ring + header radius (CSS).
    The legacy snap-apply fix is already covered by our `useCanvasSnap`.
  - `1506493a` — group-view context nodes sized by estimated node height so they
    no longer overlap (`useCanvasGroupView.ts`).
  - `e75d91aa` — port handles/markers raised above node bodies (`z-index`) and
    `elevateNodesOnSelect={false}` so selecting a node never hides its ports
    (`BatteryNode.css`, `Canvas.css`, `Canvas.tsx`).
  - `440da6a5` — annotations can be Ctrl-drag-duplicated and copy/pasted; new
    `pipelineStore.duplicateAnnotation` writes into `Pipeline.annotations` (never
    an exec node) — `pipelineStore.ts`, `useCanvasCopyPaste.ts`, `useCtrlDragGhost.ts`.
  - Bounding-box (frame) chain `3b907c5c` → `0993136a` → `40f27e51`: single-node
    frames allowed; auto-sized frame title + close-via-context-menu (no × button);
    nested-frame geometry (`getFrameZIndex`, `excludeFrameId`, title overhang pad,
    pad 42/76 → 24/48); frame copy/paste + Ctrl-drag duplicate (members + internal
    edges) + paste-crash hardening — `useCanvasFrames.ts`, `CanvasFrameNode.tsx`,
    `useCanvasCopyPaste.ts`, `useCtrlDragGhost.ts`, `Canvas.tsx`; frame geometry
    tests updated to the new padding + single-node behaviour.
  - `51dceee2` (reconciled) — favorites already exist via the shared
    `uiStore.favoriteBatteries` + sidebar `FavoritesPanel`; added the missing
    upstream affordance: "⭐ Add/Remove from Favorites" context-menu items on
    `BatteryNode`, `GroupNode` (synthetic group battery), `NumberSliderNode`, and
    the `BatteryBar` row menu — all reusing the single favorites store. We did
    **not** add a second favorites tab inside `BatteryBar` (would duplicate the
    `FavoritesPanel`).
  - `f3414fe1` (reconciled) — frame persistence: our op-based persistence already
    serializes `frames` (and `annotations`/`viewport`/`groups`) via `setMetadata`
    ops (`transport/mappers.ts`), so no legacy `createPipeline`-payload change is
    needed.

- **Architecture docs.** Added [`ARCHITECTURE.md`](./ARCHITECTURE.md),
  [`docs/architecture/`](./docs/architecture/) (runtime-layers · react-editor ·
  contracts) and [`AGENTS.md`](./AGENTS.md): a navigable, code-grounded map of
  the implemented kernel plus a read-before-write protocol for agents.

### Fixed

- **Repository CI lint baseline now uses ESLint 9 flat config.** The root
  dependency had already moved to ESLint 9, but the legacy `.eslintrc` was no
  longer loaded. The flat config preserves the TypeScript rules so the shared
  hygiene/lint/typecheck/build/test contract can run end to end again.
- **The intentionally data-only `@forgeax/i18n` workspace no longer fails the
  root test command solely because it has no test files.** Its Vitest command
  now uses `--passWithNoTests`; packages that own tests still execute normally.

- **`node-runtime`** — deterministic battery scan + first-wins duplicate-id
  guard (canonical `483431c`). `listSubdirectories()` now sorts, and `scan()`
  lets the first sorted directory win an id while skipping + reporting later
  duplicates, instead of the prior unsorted-`readdir` + silent
  `registry.replace` overwrite. Distinct `meta.id`s that merely share a
  directory basename are unaffected. Cascade: both plugins bumped `external/`
  to `483431c`. Added `battery-loader.test.ts` regression cases.
- **`node-runtime` / `node-runtime-react`** — grouping selected nodes now persists
  through the canonical kernel `createGroup` op, group shadow nodes retain
  `params.groupId`, and the editor falls back to the node id for legacy shadows.
  Live-sync/refetch no longer drops or expands freshly-created GroupNodes.
- **`node-runtime-react`** — made ReactFlow edge interaction paths explicitly
  hit-testable so the legacy double-click-on-wire relay insertion works reliably
  in real browsers, not only in hook-level tests.

### Added

- **`node-runtime-react`** — shared group-template battery support: optional
  transport methods for listing/loading/saving reusable group templates, a
  Develop/Templates toolbar toggle, BatteryBar template-mode catalog population,
  and group-template drag/drop instantiation as real group nodes.
- **`@forgeax/batteries-common`** — shared `common` battery pack for downstream
  workbench plugins. It currently hosts the migrated generic number, list,
  datatree, input, grid preview, and annotation batteries under
  `packages/batteries-common/batteries/common/**`, preserving existing `meta.id`
  op ids while letting each downstream expose them under a `common` palette tab.
- **`node-runtime-react`** — shared editor chrome components:
  `PipelineFileDialog` and `ProjectsDialog`, exported from the editor barrel. Host
  apps now reuse one Open/Save and Projects UI implementation; domain differences
  are limited to props such as default project type/name and preview wiring.
- **`node-runtime`** — `RuntimeConfig.createExecutionContext`, a generic hook for
  host apps to enrich the per-run `ExecutionContext` with plugin services (for
  example a baker/library bag) without adding domain-specific branches to the
  executor.
- **`node-runtime-react`** — **Keyboard Undo/Redo wired into the editor
  (`useCanvasUndoRedo`).** Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (Cmd on mac) now undo/redo.
  The recorded PRE-op History snapshots (incl. bridged AI/CLI `batch_applied` entries)
  were never reversible because nothing was wired to the keyboard. The new hook takes
  the target snapshot from `useHistoryStore.undo()/redo()` and re-applies it
  authoritatively via `importPipeline(replace, actor:'undo'|'redo')`, so the restore
  round-trips the canonical kernel path (`applyBatch → graph:applied → loadPipeline →
  reconcile → preview refresh`) instead of mutating local React state (no SSOT desync).
  The history bridge now treats `undo`/`redo` as **history-suppressed actors** so a
  restore never records a fresh entry or double-advances the cursor (no loop). Undoing
  an AI `batch_applied` entry restores the pre-batch graph; redo re-applies. Covered by
  `node-runtime-react/__tests__/undoRedo.test.ts`.
- **`node-runtime`** — **`ProjectRegistry` (`layer2/project-registry.ts`):
  kernel-level multi-project management (new/open/delete/switch).** A reusable,
  domain-agnostic registry backing project CRUD on disk: `workspaces/projects/index.json`
  (`ProjectIndex`), per-project `projects/<id>/manifest.json` mapping
  `projectId → { graphFile, historyFile, outputsDir }`, and `workspace.json`
  (`activeProjectId` + `recentProjectIds`). Holds a **pool of per-project `Runtime`
  instances** that share ONE `OpRegistry` (battery scan runs once, not per switch —
  `createRuntime` gained an optional `registry?` for this). API:
  `createProject({ type, name, fromTemplate? })` (fromTemplate reuses
  `importPipelineGraph` so a seed flows through the standard atomic batch),
  `listProjects`, `getProject`, `updateProject`, `deleteProject(assetPolicy?)`,
  `activateProject(id)` (persists the outgoing graph, hot-swaps the active runtime so
  subsequent `applyBatch`/queries hit the right project's storage), `getWorkspace` /
  `setWorkspace`. **Backfill:** on first init against a workspace that already has an
  implicit graph (`<root>/state/graph.json`), a default `main` project is created
  pointing at the existing files — current users keep their work with no migration.
  The `type` is an opaque tag so scene / 3d-lowpoly / future task types all reuse it;
  per-domain extras stay in the app. Covered by `__tests__/project-registry.test.ts`
  (lifecycle, activate-swap storage isolation, per-project history, fromTemplate seed,
  default backfill).
- **`node-runtime-react`** — **`useProjectStore` + project/workspace methods on
  `ApiClient` / `EditorApiAdapter`.** A Zustand store porting the legacy `projectStore`
  (`fetchProjects` / `bootstrap` / `switchProject` / `createProject` / `deleteProject` /
  `renameProject`). `switchProject` wires the faithful **open cascade** onto the existing
  reconcile/live-sync: flush the outgoing canvas → `activateProject` (server swaps
  storage) → reset transient per-pipeline state (node outputs / dynamic ports /
  group-view stack) → `loadPipeline()` → `pipelineRevision++` → `useCanvasGraphSync`
  rebuild → **`clearHistory()`** (undo stack does NOT cross projects) → `activeProjectType`
  battery filter follows the new type. `ApiClient` gained optional `listProjects` /
  `getProject` / `createProject` / `updateProject` / `deleteProject` / `activateProject` /
  `getWorkspace` / `setWorkspace` (+ `CreateProjectRequest` / `ActivateProjectResult`
  types); `EditorApiAdapter` delegates them to the host client. Additive — existing
  single-pipeline editors are unaffected. Covered by `editor/__tests__/projectStore.test.ts`.
- **`node-runtime-cli`** — **`forgeax project list|create|open|delete` subcommands**
  wrapping the registry (mirrors the `pipeline import` CLI style); builds a shared
  `OpRegistry` + `ProjectRegistry` so an agent can manage projects headlessly. Covered
  by `__tests__/project-commands.test.ts` (create → list → open → delete lifecycle).
- **`node-runtime`** — **`importPipelineGraph` (`layer2/import-graph.ts`): import a
  whole node-connection graph from a file as ONE atomic batch.** Accepts a graph in
  `kernel-graph-v1` (native snapshot shape) **or** `legacy-pipeline-v1` (the legacy
  `forgeax-wb-scene` `Pipeline` JSON, `batteryId`/`source{nodeId,port}`/`viewport`/
  `groups`/`annotations`). Every `opId` is validated against the op registry (unknown
  ids return `status:'rejected'` + `diagnostics`, never a crash); colliding node ids
  are remapped via explicit `idRemap` or auto-suffixing (`merge` mode), with the full
  mapping returned as `nodeIdMap`. Produces an ordered `Op[]` — `replace`:
  ungroup-all → delete-all → `createNode` → `connect` → `createGroup` → `setMetadata`;
  `merge`: additive with remap — and applies it through a single
  `applyBatch(rt, ops, { actor, label })` so it persists atomically **and** shows in
  History via the existing bridge. Layout/metadata (`viewport` / `annotations` /
  `frames`) round-trips through `graph.metadata`. `createNode`/`updateNode` ops gained
  optional `name` / `previewEnabled` so node labels survive the round-trip. Returns
  `{ status, batchId, newHash, nodeIdMap?, diagnostics? }`. Covered by
  `__tests__/import-graph.test.ts` (both formats, replace/merge, explicit + auto
  remap, unknown-opId diagnostic, metadata + packed-group round-trip).
- **`node-runtime-react`** — **`legacyPipelineToOps(pipeline, opts)` mapper +
  `EditorApiAdapter.importPipeline` / `importPipelineFile` / `listImportTemplates` /
  `exportPipeline`.** The mapper flattens editor groups, validates ops, remaps ids and
  emits the same ordered `Op[]` as the kernel; the adapter applies them via the kernel
  `applyBatch` path (so import flows `applyBatch → graph:applied → loadPipeline →
  pipelineRevision++ → useCanvasGraphSync reconcile → preview refresh`, NOT a canvas
  wipe) and delegates file/template/export calls to the `ApiClient` when the host wires
  them. `snapshotToPipeline` now restores `viewport`/`annotations`/`frames` from
  metadata. The editor `Toolbar` `onOpen` / `onSave` callbacks are forwarded through
  `Editor` props so a host can open/save pipeline files. Covered by
  `editor/__tests__/import.test.ts`.
- **`node-runtime-cli`** — **`forgeax pipeline import --file <path>` subcommand**
  wrapping the kernel `importPipelineGraph` for headless/LLM use:
  `--format` (auto-detected), `--mode replace|merge`, `--remap`, `--execute
  none|downstream|full`, `--actor`, `--label`. Emits the import result (and
  `executed`) as NDJSON; rejects (unknown opId, etc.) surface as a structured record +
  exit 1. Covered by `__tests__/pipeline-import.test.ts`.

### Fixed

- **`node-runtime-react`** — restored the `tree_merge` **`inferredAccess` connect-hook**
  in `editor/components/canvas/useCanvasConnect.ts` that the faithful port had
  dropped. On the first connect of `tree_merge`'s `item_0` slot the hook now reads
  the upstream port's DataTree access (+ type) via a re-ported `resolvePortAccess`
  and locks `node.params.inferredAccess` / `inferredType`; later slots are
  validated against that locked band in `isValidConnection`. Without this,
  `access:'item'` inputs fell into the structural-pack default branch instead of
  the item-concat branch. Additive and consistent with the incremental-reconcile
  work; the group / group_input / group_output node-type branches remain deferred
  (S3b), mirroring `resolvePortType`. Added `useCanvasConnect.test.tsx`.

### Added

- **`node-runtime-react`** — **History bridge: programmatic batches now appear in
  the editor History panel.** The visible panel reads `useHistoryStore`, which only
  LOCAL UI ops recorded (via the canvas hooks). PROGRAMMATIC mutations (AI agent /
  CLI / another client) flow `applyBatch → history.jsonl → graph:applied →
  loadPipeline()` and never touched the editor store, so they were invisible.
  `pipelineStore.subscribeLiveSync` now bridges a committed batch into
  `useHistoryStore`: it captures the PRE-batch pipeline snapshot **before**
  `loadPipeline()` mutates the store (so undo can restore to the pre-batch graph),
  then looks the batch up in the kernel history by `batchId` and records ONE
  `batch_applied` entry for NON-LOCAL actors, labelled from the actor + op types
  (e.g. `AI: createNode ×2, connect`) or the entry's own `label`. Local actors
  (`editor` / `local`) are skipped to avoid double-recording what the canvas hooks
  already logged; the entry carries `batchId` for idempotent de-dup of repeated
  `graph:applied` deliveries, and `batch_applied` entries never merge. New
  `EditorApiAdapter.getHistory()`; panel icon `⚡`. Covered by
  `editor/__tests__/historyBridge.test.ts` (AI batch → exactly one entry; local op
  not double-recorded; kernel `label` honoured; de-dup). Does not change the
  incremental canvas reconcile or live-sync paths.
- **`node-runtime`** — `HistoryEntryV1` and `ApplyBatchOptions` gain an optional,
  backward-compatible **`label`** field, persisted on the `history.jsonl` entry by
  `applyBatch`. Lets AI / CLI callers annotate a batch so editors can surface a
  meaningful history row; absent on existing entries and unannotated callers.
- **`node-runtime-react`** — `Editor` host **gear-menu extension slots**:
  `settingsActions` (custom action buttons in the settings dropdown) and
  `settingsStatusExtra` (extra status rows in the Status panel), plus a
  forwarded fullscreen control (`isFullscreen` / `onToggleFullscreen` driving the
  toolbar `Maximize2` / `Minimize2`), so a host can relocate its own controls and
  live status into the editor chrome.
- **`node-runtime-react`** — wire **data-probe** now shows real per-connection
  values for server-executed nodes. `subscribeLiveSync` populates the editor's
  `nodeOutputs` cache via the generic `ApiClient.getNodeOutput(nodeId, portId)` —
  listening for `node:output` (fetch + cache) and `exec:completed` (refresh every
  connected source port), with a new `refreshConnectedOutputs()` that seeds the
  cache on load and after each graph mutation. Replaces the legacy bespoke WS
  `NODE_OUTPUT` push; stays domain-agnostic. Same change rebuilds sticky-note
  **annotations** through `buildCanvasNodes` so they survive a live-sync refetch,
  and routes their drag/delete to the store.
- **`node-runtime-react`** — Canvas **frame nodes**: bounding-box frames drawn
  around a selection; frames move and delete together with their member nodes
  (`useCanvasFrames`).
- **`node-runtime-react`** — `Editor` host extension points: `showRunControl`
  (hide the toolbar Run/Stop for apps that auto-execute, e.g. the scene
  generator) and an optional `statusBar` slot below the canvas. `StatusBar` and
  `CustomSelect` are now exported from the editor barrel.
- **`node-runtime-react`** — `Editor` reflects backend reachability in the
  `StatusBar`: `connecting` on mount → `connected` once the catalog + pipeline
  load, `disconnected` on teardown (previously `connectionStatus` was never set,
  so the editor always showed "Disconnected").
- **`node-runtime-react`** — `opSpecToBattery` now honours an optional on-the-wire
  `category` / `displayGroup` UI hint (kept out of the kernel `OpSpec`; supplied
  by a domain backend), falling back to the op-id namespace when absent.
- Initial monorepo scaffold with four packages: `node-runtime`,
  `node-runtime-react`, `node-runtime-cli`, `i18n`.
- pnpm workspace configuration.
- TypeScript base config, ESLint, Prettier.
- Hygiene check (forbidden terms) wired into `.husky/pre-commit` and CI.
- Apache-2.0 license.

### Fixed

- **`node-runtime-react`** — `opSpecToBattery` no longer throws
  `Cannot read properties of undefined (reading 'map')` when an `OpSpec` omits
  `params` / `inputs` / `outputs`; each is guarded before mapping. A single bare
  spec previously rejected the whole catalog load and emptied the BatteryBar.
- **`node-runtime-react`** — `EditorApiAdapter.getCategories` splits the
  `bigTag/smallTag` category path correctly (and types entries as `ts`), so the
  palette rail (big) and accordion (small) populate instead of collapsing.
