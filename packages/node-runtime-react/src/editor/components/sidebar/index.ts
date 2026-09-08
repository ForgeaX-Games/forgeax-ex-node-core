// Faithful sidebar components barrel.
//
// App-level chrome (projects / workspace / embedded iframes / multi-project)
// is stripped; the generic editor sidebar surface — battery catalog, the
// inspector (node info / logs / compile), dev-note modal — is re-exported here.
export { default as BatteryBar } from './BatteryBar.js'
export { default as PropertiesPanel } from './PropertiesPanel.js'
export { default as DevNoteModal } from './DevNoteModal.js'
export { default as LeftSidebar } from './LeftSidebar.js'
