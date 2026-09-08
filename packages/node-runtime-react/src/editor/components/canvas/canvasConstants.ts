// Canvas-wide constants shared by Canvas.tsx and the canvas hooks: the
// nodeTypes / edgeTypes maps, node-width estimation, and node-type routing.
// Ported from the legacy editor (components/canvas/canvasConstants.ts).
//
// `nodeTypes` ships every built-in renderer (battery / relay / panels / group /
// group_input / group_output / annotation / frame). Consumer-supplied DOMAIN
// node renderers are merged per-render via `createCanvasNodeTypes(domainNodeTypes,
// domainPortTypes)` — there is no module-global registration. The same factory
// injects `domainPortTypes` into the colour-bearing renderers so domain types
// (scene / geometry) keep their colours without a global side effect.
import { createElement, type ComponentType } from 'react'
import type { NodeTypes, EdgeTypes, NodeProps, EdgeProps } from 'reactflow'
import type { Battery, ExposedPort } from '../../types.js'
import type { DomainPortTypes } from '../../utils/portTypes.js'
import BatteryNode from './BatteryNode.js'
import RelayNode from './RelayNode.js'
import ProbeEdge from './ProbeEdge.js'
import TextPanelNode from './TextPanelNode.js'
import NameListPanelNode from './NameListPanelNode.js'
import GridPanelNode from './GridPanelNode.js'
import NumberSliderNode from './NumberSliderNode.js'
import ToggleNode from './ToggleNode.js'
import AINode from './AINode.js'
import JsonNode from './JsonNode.js'
import ImageReaderNode from './ImageReaderNode.js'
import ImagePreviewNode from './ImagePreviewNode.js'
import GroupBoundaryNode from './GroupBoundaryNode.js'
import GroupNode from './GroupNode.js'
import AnnotationNode from './AnnotationNode.js'
import CanvasFrameNode from './CanvasFrameNode.js'

// Shared initial battery width (matches BatteryNode.css min-width: 180px).
export const DEFAULT_BATTERY_WIDTH = 180
export const DEFAULT_GROUP_WIDTH = 200

const PORT_CHAR_WIDTH = 7.2
const TITLE_CHAR_WIDTH = 8
const NODE_HORIZONTAL_CHROME = 88
const NODE_TITLE_CHROME = 72
const GROUP_ACTION_BUTTON_COUNT = 4
const GROUP_ACTION_BUTTON_WIDTH = 20
const GROUP_ACTION_GAP = 2
const GROUP_HEADER_HORIZONTAL_PADDING = 14
const GROUP_HEADER_NAME_ACTION_GAP = 6
const GROUP_ACTIONS_WIDTH =
  GROUP_ACTION_BUTTON_COUNT * GROUP_ACTION_BUTTON_WIDTH +
  (GROUP_ACTION_BUTTON_COUNT - 1) * GROUP_ACTION_GAP
const GROUP_TITLE_CHROME =
  GROUP_HEADER_HORIZONTAL_PADDING + GROUP_HEADER_NAME_ACTION_GAP + GROUP_ACTIONS_WIDTH

function textWidth(text: string | undefined, charWidth: number): number {
  return (text?.trim().length ?? 0) * charWidth
}

export function getBatteryDisplayName(battery: Battery, en = false): string {
  return en ? battery.nameEn || battery.id || battery.name : battery.name
}

export function estimateBatteryNodeWidth(battery: Battery, minWidth = DEFAULT_BATTERY_WIDTH): number {
  const inputMax = Math.max(
    0,
    ...battery.inputs.filter((port) => !port.hidden).map((port) => textWidth(port.label || port.name, PORT_CHAR_WIDTH)),
  )
  const outputMax = Math.max(
    0,
    ...battery.outputs.filter((port) => !port.hidden).map((port) => textWidth(port.label || port.name, PORT_CHAR_WIDTH)),
  )
  const titleMax = Math.max(
    textWidth(getBatteryDisplayName(battery, false), TITLE_CHAR_WIDTH),
    textWidth(getBatteryDisplayName(battery, true), TITLE_CHAR_WIDTH),
  )
  return Math.ceil(Math.max(minWidth, inputMax + outputMax + NODE_HORIZONTAL_CHROME, titleMax + NODE_TITLE_CHROME))
}

export function estimateGroupNodeWidth(
  group: { name: string; nameEn?: string; exposedInputs: ExposedPort[]; exposedOutputs: ExposedPort[] },
  minWidth = DEFAULT_GROUP_WIDTH,
): number {
  const labelOf = (port: ExposedPort): string =>
    port.customLabelEn?.trim() ||
    port.portLabelEn ||
    port.customLabel?.trim() ||
    port.portLabel ||
    port.sourcePortName ||
    port.portName
  const inputMax = Math.max(
    0,
    ...group.exposedInputs.filter((port) => !port.hidden).map((port) => textWidth(labelOf(port), PORT_CHAR_WIDTH)),
  )
  const outputMax = Math.max(
    0,
    ...group.exposedOutputs.filter((port) => !port.hidden).map((port) => textWidth(labelOf(port), PORT_CHAR_WIDTH)),
  )
  const titleMax = Math.max(textWidth(group.name, TITLE_CHAR_WIDTH), textWidth(group.nameEn, TITLE_CHAR_WIDTH))
  return Math.ceil(Math.max(minWidth, inputMax + outputMax + NODE_HORIZONTAL_CHROME, titleMax + GROUP_TITLE_CHROME))
}

/**
 * Map a battery to its ReactFlow node-component name (the nodeTypes key).
 *   - explicit battery.nodeType wins (from meta frontend.nodeType)
 *   - else route by type: ai -> ai_battery, json -> json_battery, else battery
 * Unregistered routed types fall back to `battery` at render time.
 */
export function resolveNodeType(battery: Battery): string {
  if (battery.nodeType) return battery.nodeType
  if (battery.type === 'ai') return 'ai_battery'
  if (battery.type === 'json') return 'json_battery'
  return 'battery'
}

// Node-type registry: every built-in renderer. Domain renderers are merged by
// `createCanvasNodeTypes`; this map is never mutated at runtime.
export const nodeTypes: NodeTypes = {
  battery: BatteryNode,
  relay: RelayNode,
  text_panel: TextPanelNode,
  name_list_panel: NameListPanelNode,
  grid_panel: GridPanelNode,
  number_const: NumberSliderNode,
  toggle: ToggleNode,
  ai_battery: AINode,
  json_battery: JsonNode,
  image_reader: ImageReaderNode,
  image_preview: ImagePreviewNode,
  group: GroupNode,
  group_input: GroupBoundaryNode,
  group_output: GroupBoundaryNode,
  annotation: AnnotationNode,
  frame: CanvasFrameNode,
  // Domain node types (scene_sink / asset_export) are injected by the consumer
  // through the `domainNodeTypes` prop, merged in `createCanvasNodeTypes`.
}

// The colour-bearing built-in renderers whose ports can carry a DOMAIN type
// (scene / geometry). They receive `domainPortTypes` as an explicit prop so
// their getPortTypeColor calls resolve domain colours without a global.
function injectDomainPortTypes(
  component: ComponentType<NodeProps & { domainPortTypes?: DomainPortTypes }>,
  domainPortTypes: DomainPortTypes,
): NodeTypes[string] {
  return (props: NodeProps) => createElement(component, { ...props, domainPortTypes })
}

// Wrap every consumer-supplied domain renderer with `injectDomainPortTypes` so
// domain node types (e.g. scene_sink → BatteryNode) resolve domain port colours
// the same way the built-in colour-bearing renderers do. Without this, domain
// renderers route through the bare BatteryNode/RelayNode and getPortTypeColor
// can't see the domain types, falling back to neutral grey.
function injectDomainNodeTypes(
  domainNodeTypes: Record<string, NodeTypes[string]>,
  domainPortTypes: DomainPortTypes,
): NodeTypes {
  const wrapped: NodeTypes = {}
  for (const [key, component] of Object.entries(domainNodeTypes)) {
    wrapped[key] = injectDomainPortTypes(component, domainPortTypes)
  }
  return wrapped
}

export function createCanvasNodeTypes(
  domainNodeTypes?: Record<string, NodeTypes[string]>,
  domainPortTypes?: DomainPortTypes,
): NodeTypes {
  if (!domainNodeTypes && !domainPortTypes) return nodeTypes
  return {
    ...nodeTypes,
    ...(domainPortTypes
      ? {
          battery: injectDomainPortTypes(BatteryNode, domainPortTypes),
          relay: injectDomainPortTypes(RelayNode, domainPortTypes),
          group: injectDomainPortTypes(GroupNode, domainPortTypes),
          group_input: injectDomainPortTypes(GroupBoundaryNode, domainPortTypes),
          group_output: injectDomainPortTypes(GroupBoundaryNode, domainPortTypes),
          // CanvasFrameNode exports an SVG/PNG whose wire/port colours must keep
          // domain colours; inject the same prop so the export resolves them.
          frame: injectDomainPortTypes(CanvasFrameNode, domainPortTypes),
        }
      : {}),
    // Domain renderers must be merged last so they can still override a built-in
    // key, but they also need `domainPortTypes` injected just like the built-ins
    // above — otherwise their domain ports fall back to the neutral grey.
    ...(domainNodeTypes
      ? domainPortTypes
        ? injectDomainNodeTypes(domainNodeTypes, domainPortTypes)
        : domainNodeTypes
      : {}),
  }
}

// Override ReactFlow's default edge type: every untyped edge uses ProbeEdge.
// ProbeEdge is identical to a standard bezier edge when probe mode is off. The
// wire colour follows the source port type, so the probe edge also needs the
// domain port types — injected per-render the same way as the node renderers.
export const edgeTypes: EdgeTypes = {
  default: ProbeEdge,
}

export function createCanvasEdgeTypes(domainPortTypes?: DomainPortTypes): EdgeTypes {
  if (!domainPortTypes) return edgeTypes
  return {
    default: (props: EdgeProps) => createElement(ProbeEdge, { ...props, domainPortTypes }),
  }
}
