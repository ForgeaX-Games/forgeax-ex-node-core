// Faithful canvas module — public surface.
//
// Ships the ReactFlow canvas shell, the built-in node renderers, the data-probe
// edge, and the node/edge type factories (`createCanvasNodeTypes` /
// `createCanvasEdgeTypes`) that merge consumer DOMAIN node types and inject
// `domainPortTypes` into the colour-bearing renderers — no global registry.

export { default as Canvas } from './Canvas.js'
export { default as BatteryNode, ContextMenuPortal, PortOptionsPicker } from './BatteryNode.js'
export type { ContextMenuState, ContextMenuItem } from './BatteryNode.js'
export {
  default as RelayNode,
  RELAY_BATTERY_ID,
  RELAY_INPUT_PORT,
  RELAY_OUTPUT_PORT,
  RELAY_NODE_HEIGHT,
  RELAY_NODE_WIDTH,
} from './RelayNode.js'
export { default as ProbeEdge } from './ProbeEdge.js'
export { default as GroupNode, buildGroupNodeData } from './GroupNode.js'
export type { GroupNodeData } from './GroupNode.js'
export { GroupSaveDialog } from './GroupSaveDialog.js'
export {
  nodeTypes,
  edgeTypes,
  createCanvasNodeTypes,
  createCanvasEdgeTypes,
  resolveNodeType,
  estimateBatteryNodeWidth,
  estimateGroupNodeWidth,
  getBatteryDisplayName,
  DEFAULT_BATTERY_WIDTH,
  DEFAULT_GROUP_WIDTH,
} from './canvasConstants.js'
export { useCanvasConnect } from './useCanvasConnect.js'
export { useCanvasDrop, type PlaceBatteryFn } from './useCanvasDrop.js'
export { useCanvasDelete } from './useCanvasDelete.js'
export { useCanvasGrid } from './useCanvasGrid.js'
export { useCanvasGraphSync, buildCanvasNodes, buildCanvasEdges } from './useCanvasGraphSync.js'
export {
  useCanvasFrames,
  computeFrameGeometry,
  nearlySameFrameGeometry,
  getRfNodeSize,
} from './useCanvasFrames.js'
export { useCanvasUndoRedo, restoreSnapshot } from './useCanvasUndoRedo.js'
export {
  TooltipPortal,
  useNodeTooltip,
  formatPortValue,
  formatPortValueExtra,
  ValueFormattersProvider,
  useNodeValueFormatters,
  resolveInputPortValue,
  type TooltipState,
  type BatteryTooltipState,
  type DomainValueFormatter,
  type DomainValueFormatters,
} from './nodeTooltip.js'
