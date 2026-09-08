// Faithful editor module — public surface.
//
// Stage 2 ships the data backbone: editor types, the transport adapter that
// bridges the legacy data services onto the kernel ApiClient, and the ported
// zustand stores. Faithful components land in later stages and are added here.

export * from './types.js'
export * from './stores/index.js'
export {
  createEditorTransport,
  configureEditorTransport,
  getEditorTransport,
  peekEditorTransport,
  EditorApiAdapter,
  WsAdapter,
  diffPipelineToOps,
  graphNodeToPipelineNode,
  graphEdgeToPipelineEdge,
  legacyPipelineToOps,
  opSpecToBattery,
  snapshotToPipeline,
} from './transport/index.js'
export type {
  EditorTransport,
  ApplyResult,
  ApplyDiagnostic,
  ImportPipelineResult,
  EditorEvent,
  EditorEventMap,
  LegacyPipelineToOpsOptions,
  LegacyPipelineToOpsResult,
} from './transport/index.js'

// Canvas: the ReactFlow shell, BatteryNode, RelayNode, ProbeEdge and the
// node/edge type registry.
export * from './components/canvas/index.js'
// Sidebar: battery catalog + inspector + dev-note modal + left sidebar.
export { BatteryBar, PropertiesPanel, DevNoteModal, LeftSidebar } from './components/sidebar/index.js'
// Shared primitives: the bottom StatusBar + CustomSelect portal dropdown.
export { StatusBar, CustomSelect } from './components/common/index.js'
export type { CustomSelectOption } from './components/common/index.js'
// Toolbar: the top toolbar shell + its settings panels and standalone toggles,
// so a host that hides the gear can re-surface those controls elsewhere.
export {
  Toolbar,
  SettingsHistoryPanel,
  SettingsDataTypesPanel,
  SettingsInfoPanel,
  LanguageToggle,
  DevNoteCountToggle,
} from './components/toolbar/index.js'
export type { ToolbarProps } from './components/toolbar/index.js'
// Same-origin editor sync bridge: lets a side pane mirror the center editor's
// live history + status and post commands back.
export { createEditorBridge, useEditorBroadcastHost } from './sync/editorBridge.js'
export type {
  EditorBridge,
  EditorBridgeCommand,
  EditorMirrorSnapshot,
  EditorStatusView,
  HistoryEntryView,
} from './sync/editorBridge.js'
// Shared editor chrome used by host apps for Open/Save and project management.
export { PipelineFileDialog, ProjectsDialog, ProjectPanel, EditorControlsPanel } from './components/chrome/index.js'
export type { PipelineFileDialogProps, ProjectsDialogProps, ProjectPanelProps, EditorControlsPanelProps } from './components/chrome/index.js'
// Composed editor: Toolbar · BatteryBar · Canvas in the legacy layout.
export { Editor } from './Editor.js'
export type { EditorProps } from './Editor.js'
// Port / battery / datatree utilities the canvas components are built on.
export * from './utils/portTypes.js'
export * from './utils/batteryLabels.js'
export * from './utils/datatreeShape.js'
// Domain value formatters are supplied per editor instance via the
// `<Editor domainValueFormatters={...}>` prop (a React Context under the hood),
// NOT a module-global registry. The former `configureDomainValueFormatters`
// global was removed in P5 — pass the prop instead.
export type { DomainValueFormatter, DomainValueFormatters } from './components/canvas/nodeTooltip.js'
