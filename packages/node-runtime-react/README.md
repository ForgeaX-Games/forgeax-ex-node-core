# @forgeax/node-runtime-react

React 18 component library shared by ForgeaX node-programming plugins.
Generic DAG-editor primitives: a `NodeCanvas` shell, an `Inspector`,
a `BatteryPalette`, plus the hooks and panel renderers that compose
them. Every component is decoupled from any zustand store and consumes
the kernel exclusively via a browser-safe `ApiClient` (Layer 2).

```tsx
import {
  NodeCanvas,
  Inspector,
  BatteryPalette,
  type ApiClient,
} from '@forgeax/node-runtime-react'

function App({ client }: { client: ApiClient }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <BatteryPalette apiClient={client} />
      <div style={{ flex: 1 }}>
        <NodeCanvas pipelineId="demo" apiClient={client} />
      </div>
      <Inspector apiClient={client} selectedNodeId={selected} />
    </div>
  )
}
```

## Status — v0.3.0

✅ Self-contained lightweight kernel surface:
- `NodeCanvas` shell composes the hooks + components + panel registry.
- `Inspector` reads selected node, renders typed param editors over apiClient.
- `BatteryPalette` lists ops via `apiClient.listOps()` with native HTML drag.
- 10 hooks: `useGraphSync`, `useCanvasConnect`, `useCanvasDelete`,
  `useCanvasDrop`, `useCanvasSnap`, `useCanvasUndoRedo`,
  `useCanvasCopyPaste`, `useCtrlDragGhost`, `useSessionRestore`,
  `useAssetImport`.
- 5 core components: `BatteryNode`, `RelayNode`, `ProbeEdge`,
  `CanvasSearchPopover`, `nodeTooltip` + `canvasConstants`.
- 8 panel renderers under `panels.*`: `NumberSliderPanel`,
  `TogglePanel`, `GridPanel`, `TextPanel`, `JsonPanel`,
  `ImagePreviewPanel` + `useAssetPath`, `AnnotationNode`,
  `CanvasFrameNode` + `exportFrameToPng`.
- `ApiClient` interface ships in `src/api/ApiClient.ts` with a 5-clause
  contract docstring (lifetime, query semantics, read-after-write,
  subscription ordering, `getPipeline()` preference).
- **Group system (Phase G):** `useCanvasGroup` + `useCanvasGroupView`
  hooks, `GroupNode` + `GroupBreadcrumb` components, full Layer 2
  Group Ops support via `@forgeax/node-runtime@^0.2.0`.
- **Visual fidelity (Phase H):** `NodeCanvasTheme` design-token surface,
  `defaultTheme` / `legacyTheme` bundles, optional
  `@forgeax/node-runtime-react/styles.css` sub-export with 46
  CSS custom properties for one-line legacy parity.
- 149 tests, full hygiene gate, no `any`, no legacy stores, English-only.

📦 Stubbed pending P5:
- `PipelineControls`, `AssetBrowser`, `HistoryView`, `PathSlotsPanel`.

## Roadmap

- **v0.4.0 / nested groups** — `addNestedGroup` Op + member
  reconciliation in `updateGroup`. Currently kernel rejects
  member-is-group; nested groups will land via a dedicated minor.
- **v0.5.0** — `useCanvasUndoRedo` / `useCanvasCopyPaste` /
  `useCtrlDragGhost` auto-wired into the shell behind feature flags.
  Layer 2 `executeNode` API integration when kernel ships it.

See `docs/superpowers/plans/2026-05-29-p4-react-ui-migration.md` for
the full plan, lessons-learnt section, and Phase G/H definitions of
done.

## Dev playground

A sectioned demo of every component / hook / panel:

```sh
pnpm --filter @forgeax/node-runtime-react dev          # Vite at :5173
pnpm --filter @forgeax/node-runtime-react snapshot     # headless PNGs
```

27 demo scenarios cover the v0.2.0 surface end-to-end. PNGs land in
`dev/screenshots/` (gitignored).

## Consumer pattern

`ApiClient` is a contract — consumers implement it over their
transport of choice (HTTP, WebSocket, IPC, in-process). The kernel
ships an implementation backed by `Runtime` (Node-side); the test
fixture `src/test/mockApiClient.ts` is an in-memory implementation
mirroring the same contract, suitable for any browser-side test.

## License

Apache-2.0.
