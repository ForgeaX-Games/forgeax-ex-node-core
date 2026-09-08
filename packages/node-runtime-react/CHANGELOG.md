# Changelog

All notable changes to `@forgeax/node-runtime-react`. Format: Keep a
Changelog · semver. Dates are calendar dates in the project timezone.

## Unreleased

### Added — Shared editor chrome

- **`PipelineFileDialog` and `ProjectsDialog` moved into the shared editor
  package.** Host apps import them from `@forgeax/node-runtime-react/editor`
  instead of copying Open/Save and Projects UI locally. `ProjectsDialog` accepts
  host defaults (`defaultProjectType`, `defaultProjectName`) so scene and
  3d-lowpoly keep only domain labels/types while sharing the underlying
  project/import/export mechanics.
- Covered by `editor/__tests__/editorChrome.test.tsx`.

### Added — Keyboard Undo/Redo wired into the editor (reversible History)

- **Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z now drive undo/redo.** `useHistoryStore`
  already recorded PRE-op snapshots (incl. the bridged AI/CLI `batch_applied`
  entries) and tracked undo/redo state, but nothing was wired to the keyboard, so
  undo was a no-op for ALL actors. New
  **`useCanvasUndoRedo`** (`editor/components/canvas/useCanvasUndoRedo.ts`) ports
  the legacy keybindings (Cmd on mac; ignores INPUT/TEXTAREA/SELECT; capture-phase
  + `stopPropagation` so it never collides with the Ctrl+G group handler) and is
  mounted by `Canvas`.
- **Restore keeps the kernel SSOT consistent.** Unlike the legacy editor (which
  mutated local React state), an undo/redo takes the target snapshot from
  `useHistoryStore.undo()/redo()` and re-applies it AUTHORITATIVELY via
  `EditorApiAdapter.importPipeline(snapshot, { mode: 'replace', actor })`, so the
  graph round-trips the canonical path: `applyBatch → graph:applied →
  loadPipeline → pipelineRevision++ → useCanvasGraphSync reconcile → preview
  refresh`. No local-state desync; previews refresh via the existing
  `exec:completed` path. Exported as `restoreSnapshot`.
- **Loop guard.** The history bridge now treats `undo` / `redo` as
  **history-suppressed actors** (alongside `editor` / `local`): re-applying a
  snapshot does NOT record a fresh `batch_applied` entry, and the cursor moves
  ONLY through the undo/redo stack logic — preventing an undo→record→undo loop or
  a double-advanced cursor.
- **Works for AI/CLI entries.** Because entries store the PRE-op snapshot,
  undoing a `batch_applied` (AI) entry restores the pre-batch graph and redo
  re-applies it. The undo stack is still cleared on project switch
  (`projectStore`, unchanged).
- Covered by `editor/__tests__/undoRedo.test.ts` (record→undo→redo targets the
  right snapshot; restore applied via the apply path with `actor:'undo'`/`'redo'`;
  no new history row / no cursor double-advance; undoing an AI batch restores the
  pre-batch graph).

### Added — Import a node-connection graph from a file

- **`legacyPipelineToOps(pipeline, opts)`** (`editor/transport/mappers.ts`) — converts
  an editor `Pipeline` (legacy or current) into an ordered `Op[]`: flattens groups
  into flat nodes/edges + `createGroup` specs (re-wiring exposed ports), validates each
  `opId` against the registry, remaps colliding ids (explicit `idRemap` or auto-suffix
  in `merge` mode), and emits `deleteNode` (replace) → `createNode` → `connect` →
  `createGroup` → `setMetadata`. Returns `{ ops, nodeIdMap, diagnostics }`.
- **`EditorApiAdapter`** gained `importPipeline(pipeline, opts)` (applies the mapper's
  ops through the kernel `applyBatch` path — so import drives the live-sync reconcile
  cascade, never an ad-hoc canvas wipe), plus `importPipelineFile`, `listImportTemplates`
  and `exportPipeline` that delegate to the `ApiClient` when the host provides those
  routes. `applyOps` now accepts an optional `label` for History.
- **Metadata round-trip** — `snapshotToPipeline` restores `viewport` / `annotations` /
  `frames` from `graph.metadata`, the mirror of the kernel writing them on import.
- **Toolbar wiring** — `Editor` forwards new `onOpen` / `onSave` props to the
  `Toolbar`, letting a host open/save pipeline files (open → choose template → import →
  live cascade; save → export current graph).
- Covered by `editor/__tests__/import.test.ts`.

### Added — History bridge (AI/CLI ops show in the History panel)

- **Programmatic batches now appear in the visible History panel.** The panel
  (`SettingsHistoryPanel`) reads `useHistoryStore`, which only LOCAL UI ops fed
  (via the canvas hooks). PROGRAMMATIC mutations (AI agent / CLI / another client)
  flow `applyBatch → history.jsonl → graph:applied → loadPipeline()` and never
  touched the editor store, so they were invisible. `pipelineStore.subscribeLiveSync`
  now bridges a committed batch into `useHistoryStore`:
  - Captures the PRE-batch pipeline snapshot **before** `loadPipeline()` overwrites
    `currentPipeline` (race-safe), so a bridged entry can undo back to the pre-batch
    graph.
  - Looks the batch up in the kernel history by `batchId` (the `graph:applied`
    payload carries only the id) via the new `EditorApiAdapter.getHistory()`, and
    records ONE `batch_applied` entry for NON-LOCAL actors, labelled from the
    actor + op types (`AI: createNode ×2, connect`) or the kernel entry's own
    `label`.
  - Skips local actors (`editor` / `local`) so it never double-records what the
    canvas hooks already logged; the entry stores `batchId` for idempotent de-dup
    of repeated deliveries. New `'batch_applied'` `HistoryActionType` (panel icon
    `⚡`) that never participates in consecutive-merge — each committed batch is a
    discrete step.
- Does NOT change the incremental canvas reconcile, external/LLM live-sync, or the
  tree_merge/add_child paths. Covered by `editor/__tests__/historyBridge.test.ts`.

### Deferred

- **Undo for AI/CLI ops via Ctrl+Z.** The kernel editor does not bind Ctrl+Z/Ctrl+Y
  to the snapshot-undo model (only Ctrl+G grouping is wired) — a pre-existing gap
  for ALL ops, not a regression. Bridged entries are visible and counted in the
  undo/redo badges, but actual restore (which must round-trip the restored graph
  back through `applyBatch`, bump `pipelineRevision`/`sessionRestorePending`, and
  refresh previews to stay consistent with the kernel SSOT) is a separate, riskier
  change tracked as a follow-up.

## [0.5.0] — 2026-05-30

### Added — editor probe / relay affordances

- The editor toolbar again exposes a visible data-probe toggle (`.toolbar-btn-probe`)
  while keeping the settings checkbox. Probe edges now show an explicit `no output`
  state instead of a silent dash before a source port has produced a value.
- Canvas quick-search now includes a virtual **Relay** entry that creates the kernel
  sentinel `__relay__` node. Relay stays editor/kernel infrastructure, not a catalog
  battery or common pack member; its connection typing still follows the upstream
  port and runtime pass-through remains handled by the kernel sentinel.

### Added — faithful legacy editor port (`@forgeax/node-runtime-react/editor`)

The v0.4.0 editor was a ~5% approximation (507 LOC CSS) of the legacy product. v0.5.0 ships a new `src/editor/` module that faithfully re-ports the real legacy editor — its CSS, components, and interactions — adapting only the data/transport layer onto the kernel `ApiClient`. Exposed via the new `./editor` subpath + `./editor.css`.

- **Design system** — the legacy 71-var `:root` theme, ported verbatim.
- **`<Editor>`** — the composed editor (Toolbar · BatteryBar · Canvas) in the real `.app`/`.editor-pane`/`.main-layout`/`.main-content`/`.canvas-container` layout. Props: `apiClient`, `domainNodeTypes`, `toolbarActions`, `title`. On mount it points the editor transport at the client and subscribes the pipeline store to the `graph` channel — so a mutation from any actor (human, or an AI/CLI on the same backend) syncs live onto the canvas (the North-Star "watch the AI work" loop).
- **Transport adapter** — bridges the legacy `apiService`/`wsService` data layer onto the kernel `ApiClient` (listOps→batteries, applyBatch→updates, execute, group ops, `graph:applied`→refetch).
- **Stores** — ported zustand `pipelineStore` / `historyStore` / `uiStore`.
- **Canvas node types** — `battery`, `relay`, `text_panel`, `name_list_panel`, `grid_panel`, `number_const`, `toggle`, `ai_battery`, `json_battery`, `image_reader`, `image_preview`, `group`, `group_input`, `group_output`, `annotation`, `frame`. `registerCanvasNodeType` is the extension + domain-injection slot (`scene_sink`/`asset_export`).
- **GroupNode** + save-as-battery dialog (catalog adapted: categories derived from the live graph; structural persist via the transport `createGroup` op).
- **Canvas interactions** — type-validated connect, double-click search popover (quick add), drag-from-palette, delete, **full group system** (create via Ctrl/Cmd+G, ungroup, enter/exit/breadcrumb, nested inner views), copy/paste (Ctrl+C/V), snap-align guides + node-move persistence/history, Ctrl+drag duplicate.
- **Sidebar / toolbar** — BatteryBar catalog, PropertiesPanel, LeftSidebar, DevNoteModal, Toolbar (Run/Stop + injectable actions slot), StatusBar, settings panels.

### Fixed — incremental canvas update (drag-add no longer reloads every node)

- **A local edit re-initialised ALL nodes.** The live-sync rebuild (above) keyed a *blanket* `setNodes(built)` on `pipelineRevision`, handing every node a freshly-built object on every committed batch. Because a local edit (drag-add / connect / param tweak) persists through `incrementalExecute → updatePipeline → applyBatch`, and the backend broadcasts `graph:applied` on **every** batch (including the editor's own), the local edit round-tripped into `loadPipeline() → pipelineRevision++ → full rebuild`. `memo(BatteryNode)` then re-rendered for *every* node — i.e. "drag one battery onto the canvas and all batteries reload/re-initialise". The legacy editor never did this: a full ReactFlow rebuild fired only on the gated session-restore signal (initial / file load / undo-redo, see legacy `useSessionRestore.ts`), while local edits drove `setNodes`/`setEdges` incrementally so untouched nodes kept their object identity. Ported that contract: `useCanvasGraphSync` now reconciles the freshly-built node/edge lists against the current ReactFlow layer (`reconcileCanvasNodes` / `reconcileCanvasEdges`) — added/changed/removed nodes update, everything else keeps its previous object reference (so memo'd node components don't re-render). External / LLM / CLI batches still sync in (a new node in the snapshot is added, a removed one dropped); selection is preserved. Adding 1 battery to a 24-node canvas now rebuilds 1 node object instead of 25 (0/24 unaffected batteries re-render, was 24/24). Covered by `canvasGraphSync.reconcile.test.ts`; the existing `canvasGraphSync.rebuild.test.tsx` (external sync) still passes.

### Fixed — live-sync canvas rebuild

- **External / refetched graph snapshots never rebuilt the canvas.** The North-Star loop ("any actor's mutation syncs live onto the canvas") was wired through `graph:applied → loadPipeline()`, but `useCanvasGraphSync` keyed its ReactFlow rebuild on `currentPipeline.id` — a constant (`'main'`) for the bound pipeline. Every refetch therefore replaced the snapshot content under the same id and the rebuild effect never re-fired, so LLM/CLI-driven batches (and even a plain page refresh that resolved the snapshot before the battery catalog) showed an empty/stale canvas. `pipelineStore` now exposes a monotonic `pipelineRevision` bumped on every `loadPipeline()`, and the canvas keys its rebuild on the revision **and** on the battery catalog becoming available (so a snapshot loaded before the catalog — which would otherwise drop every node on the battery-lookup miss — is rebuilt once batteries arrive). Selection is preserved across rebuilds. Covered by `canvasGraphSync.rebuild.test.tsx`.

### Deferred (tracked follow-ups, full-fidelity DoD — not dropped)

- **Frames** — the `CanvasFrameNode` + PNG-export are ported; the create-gesture + drag-containment wiring remains (organizational/peripheral).
- **Asset import** — paste/drop image → asset node; blocked on a kernel asset-*upload* API (the kernel `ApiClient` is read-side `resolveAssetPath` only). Needs kernel-side asset-ingestion design first.
- **In-group edge editing** — external context-node remap + in-group node deletion (internal-edge add/remove + inner node-move already persist).

The v0.4.0 approximated surface (`NodeCanvas`/`Inspector`/`NodeEditor`/…) remains exported unchanged for now.

## [0.4.0] — 2026-05-30

### Added — complete editor UI

- `StatusBar` — connection / execution status / node+edge counts, sourced from the `ApiClient` (refetches on the `graph` channel).
- `PipelineControls` — real Run control via `ApiClient.execute()`; status from the `execution` channel (was a stub).
- `Toolbar` — generic editor shell (title + Run + optional undo/redo + an injectable `actions` slot for domain buttons).
- `HistoryView` — real history list via `ApiClient.getHistory()` (was a stub); `DataTypesPanel` — port data-type reference.
- **`NodeEditor`** — a COMPOSED, domain-agnostic editor: Toolbar + BatteryPalette + NodeCanvas + Inspector + StatusBar in one mount. Injection slots: `panelOverrides` (domain node bodies), `toolbarActions` (domain buttons). Live-sync inherited from NodeCanvas's `useGraphSync` (canvas refetches on graph mutations, incl. AI/CLI-driven ones on the same backend).

All additions are domain-agnostic and theme-token styled. Deferred to v0.4.x: the rich LeftSidebar (favorites/presets/datatypes tabs) and fine-grained `canvas:op` per-op live-sync.

## [0.3.1] — 2026-05-29

### Added — editor completion

- `ApiClient.execute(request?: { nodeId?: string }): Promise<ExecutionResult>` — execution is now a first-class interface method (was a consumer-only extra). Implemented in `MockApiClient`. `ExecutionResult` is re-exported from `@forgeax/node-runtime`.
- `NodeCanvasProps.onSelectionChange?: (selectedNodeIds: readonly string[]) => void` — lets a consumer lift canvas selection to drive a separate `<Inspector selectedNodeId=...>`. (Previously selection was internal-only; the editor demo used synthetic selection.)

### Changed

- Requires `@forgeax/node-runtime@^0.3.1` (whose `applyBatch` now emits `graph:applied` on the subscription bus, so consumers reactively refetch on mutation).

## [0.3.0] — 2026-05-29

### Added — Phase G · Group system

Requires `@forgeax/node-runtime@^0.2.0` (Layer 2 Group Ops).

- `useCanvasGroup({ client })` — wraps `createGroup` / `ungroup` /
  `updateGroup` Layer 2 ops into menu-action helpers. `groupSelected`
  derives the new group's position from member centroid when not
  supplied, generates `g-<uuid>` ids, and surfaces success via
  `Promise<string | null>`.
- `useCanvasGroupView({ client })` — UI navigation state for drilling
  into a group's sub-graph. Maintains a `trail` stack, resolves
  breadcrumb labels via `client.getGroup`, and refetches the
  current sub-graph on every `graph` event while non-top.
- `GroupNode` — ReactFlow custom node rendered for `node.opId === '__group__'`.
  Reads exposed input/output ports from the sub-graph and renders one
  `<Handle>` per port. Double-click fires `data.onEnterGroup`.
  Theme-driven via `t.battery.accentByKey['group']` + `t.node.*`.
- `GroupBreadcrumb` — clickable trail chip strip; each chip jumps to
  a depth via `onJump(depth)`.
- `ApiClient` extended with `getGroup(id)` + `listGroups()`. `MockApiClient`
  implements the full Op + query surface.
- `NodeCanvas` shell registers `'group'` as a default `nodeType`; a
  group's shadow node renders as `GroupNode` automatically.

### Added — Phase H · Visual fidelity restoration

- `NodeCanvasTheme` token surface now covers node card, relay, annotation,
  frame, port handles, edge palette by run-state, per-battery accent
  map, and surface chrome.
- `defaultTheme` (minimal v0.2.0 look, centralised) and `legacyTheme`
  (recreates the original application's chrome) bundles exported
  via `@forgeax/node-runtime-react/themes` (and re-exported from the
  main entry). `resolveTheme()` deep-merges consumer overrides.
- Optional CSS sub-export `@forgeax/node-runtime-react/styles.css`
  with 46 `--forgeax-*` custom properties keyed to the same taxonomy.
  One-line legacy-parity import for consumers that prefer cascade
  overrides over TypeScript token bundles.
- 15 components / panels refactored to read theme tokens instead of
  inline literals. Backwards-compatible: every theme field optional.
- `NodeCanvas` shell resolves the theme once and threads it through
  `data.theme` so downstream components receive the same bundle.

### Removed

- Nothing — Phase G/H are purely additive on top of the v0.2.0 surface.

### Kernel dependency bump

- `@forgeax/node-runtime` peer requirement: `^0.2.0` (was `^0.1.0`).
  v0.2.0 ships the Layer 2 Group Ops Phase G needs.

## [0.2.0] — 2026-05-29

### Added — Phase A · setup

- Browser-safe `ApiClient` interface mirroring kernel Layer 2
  (applyBatch + queries + subscribe + resolveAssetPath + optional
  dispose). Five-clause contract docstring covers lifetime, query
  semantics, read-after-write consistency, subscription ordering,
  and the recommended use of `getPipeline()` for consistent reads.
- `MockApiClient` in-memory implementation for tests with seedable
  state, cascade-edge-delete on `deleteNode`, optimistic-concurrency
  rejection, and synchronous `graph` channel emission.
- 12 contract tests pinning every clause.
- Vite dev playground (`pnpm dev`) + Playwright headless snapshot
  pipeline (`pnpm snapshot`) producing one PNG per demo scenario.

### Added — Phase B · 10 hooks

- `useGraphSync` — bridges ApiClient to ReactFlow nodes/edges via a
  single `getPipeline()` round-trip on mount + `subscribe('graph')`.
- `useCtrlDragGhost`, `useCanvasSnap`, `useSessionRestore`,
  `useCanvasConnect`, `useCanvasDelete`, `useCanvasDrop`,
  `useCanvasCopyPaste`, `useCanvasUndoRedo` (local inverse-batch
  stack — kernel has no undo Op), `useAssetImport`.

### Added — Phase C · 5 core components

- `BatteryNode` — generic DAG-node body with handle rendering,
  selection styling, status indicator, and a `renderBody` seam for
  domain panels.
- `RelayNode`, `ProbeEdge` (run-state coloured edge),
  `CanvasSearchPopover` (double-click op picker with keyboard nav),
  `nodeTooltip`, `canvasConstants` (generic-only registries).

### Added — Phase D · 8 panel renderers

- `NumberSliderPanel`, `TogglePanel`, `GridPanel`, `TextPanel`,
  `JsonPanel`, `ImagePreviewPanel` + `useAssetPath` cache hook,
  `AnnotationNode`, `CanvasFrameNode` + `exportFrameToPng` /
  `copyFramePngToClipboard`.

### Added — Phase E · v0.2.0 shells

- `NodeCanvas` shell — composes 6 hooks + 5 components + panel
  registry. `panelOverrides` for per-opId customisation,
  `renderNode` as full-control fallback, `theme` for colour/spacing
  knobs. Search popover on double-click, viewport persisted via
  `useSessionRestore`, drag-snap guides, drop creates nodes.
- `Inspector` — reads selected node + opSpec, renders boolean /
  number / string / JSON-fallback editors per param.
- `BatteryPalette` — drag-source listing of every op via
  `apiClient.listOps()`; `FORGEAX_OP_ID_MIME` dataTransfer key
  matches `useCanvasDrop`.
- Public barrel exports the entire surface plus every hook,
  component, and panel for consumer recomposition.

### Fixed

- B5 demo: tracked selection in component state via
  `onSelectionChange` (useGraphSync rebuilds nodes on every event,
  wiping ReactFlow's `.selected`); enabled `selectionOnDrag` +
  `panOnDrag={[1,2]}` so left-drag rubber-bands.
- C4 demo: open search popover via `<ReactFlow onPaneClick>` +
  `event.detail === 2` (wrapper-level `onDoubleClick` fired
  unreliably under ReactFlow's stacked handler layers).
- D8 export: replaced SVG `<foreignObject>` rasterisation
  (cross-origin styles tainted the canvas in real browsers) with a
  pure-Canvas placeholder. Full DOM fidelity returns in Phase H.

### Deferred (decoupled, not dropped)

- **Phase G — group system.** `useCanvasGroup`, `useCanvasGroupView`,
  `GroupNode`, `GroupBoundaryNode`, `GroupBreadcrumb`,
  `GroupSaveDialog`. Requires kernel-side Layer 2 Group Ops
  (decision pass before implementation). Lands in v0.3.0.
- **Phase H — visual fidelity restoration.** Components ship with
  inline `style={{...}}` + literal hex colours rather than the
  legacy CSS variables / `color-mix()` chrome. Theme token surface
  + optional `styles.css` sub-export restore parity. Lands in
  v0.3.0 or v0.4.0.

### Stubbed for P5

`PipelineControls`, `AssetBrowser`, `HistoryView`, `PathSlotsPanel`
ship as exports that render a "not implemented" banner; real
implementations land in P5.

## [0.1.0] — 2026-05-28

Initial scaffold (8 stub exports, vitest config, peer deps). No
consumer-visible behaviour beyond maintaining a stable export
surface for migration-window installs.
