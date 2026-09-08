// Public surface — @forgeax/node-runtime-react (`.` entry).
//
// The faithful, supported editor lives at the `./editor` sub-export
// (`@forgeax/node-runtime-react/editor`): the real <Editor>, canvas, node types
// and stores. Both first-party apps (scene-generator, 3d-lowpoly) consume only
// `./editor` for runtime, and import just the API-contract TYPES (ApiClient,
// ActivateProjectResult, CreateProjectRequest) from this `.` entry.
//
// The original v0.2.0 "P4 approximation" composable tree (NodeCanvas, Inspector,
// BatteryPalette, StatusBar, Toolbar, NodeEditor, PipelineControls, AssetBrowser,
// HistoryView, PathSlotsPanel and the parallel hooks/ + components/ + panels/
// trees) was a deprecated surface superseded by `./editor`. It was confirmed
// unused by every first-party consumer and has been REMOVED. New code must
// import from `@forgeax/node-runtime-react/editor`.
//
// What the `.` entry still exports, and why:
//   * API contract types — the stable cross-process contract both apps type
//     their HttpApiClient against.
//   * Theme bundles — the self-contained `./themes` surface, also re-exported
//     here for back-compat (`./themes` remains the canonical import path).

// API contract ---------------------------------------------------------------
export type { ApiClient, ActivateProjectResult, CreateProjectRequest, GroupTemplateBattery } from './api/index.js'

// Theme bundles + token resolver --------------------------------------------
export { defaultTheme, legacyTheme, resolveTheme } from './themes/index.js'
export type { NodeCanvasTheme } from './themes/index.js'
