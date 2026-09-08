// Frame-to-SVG/PNG clipboard export for canvas frames. Ported verbatim from the
// legacy editor (components/canvas/canvasFrameExport.ts) with imports retargeted
// onto the editor types + sibling utils. Uses only DOM + clipboard APIs.
import type { Edge, Node } from 'reactflow'
import type { Battery, BatteryPort, CanvasFrame, NodeGroup, Pipeline, PipelineNode } from '../../types.js'
import { getPortTypeColor, type DomainPortTypes } from '../../utils/portTypes.js'

const FALLBACK_NODE_WIDTH = 180
const FALLBACK_NODE_HEIGHT = 86
const HEADER_HEIGHT = 30
const PORT_ROW_HEIGHT = 20
const SVG_PAD = 40
const TITLE_BAND = 38
const RELAY_BATTERY_ID = '__relay__'
const PNG_RASTER_SCALE = 4
const EXPORT_TEXT_COLOR = '#000000'
const FRAME_TITLE_TEXT_COLOR = '#ffffff'

type ExportPort = Pick<BatteryPort, 'name' | 'type' | 'label' | 'hidden'>
  & { labelEn?: string }

interface FrameSvgExportInput {
  frameId: string
  pipeline: Pipeline
  batteries: Battery[]
  rfNodes: Node[]
  rfEdges?: Edge[]
  domainPortTypes?: DomainPortTypes
}

interface ExportNodeView {
  id: string
  x: number
  y: number
  width: number
  height: number
  title: string
  kind: 'battery' | 'group' | 'relay'
  inputs: ExportPort[]
  outputs: ExportPort[]
  theme: NodeVisualTheme
}

export type FrameExportClipboardMode = 'image/png' | 'image/svg+xml' | 'text/html' | 'text/plain'

interface NodeVisualTheme {
  fill: string
  header: string
  stroke: string
  titleColor: string
  portColor: string
}

interface FrameVisualTheme {
  titleFill: string
  titleStroke: string
  titleColor: string
  frameFill: string
  frameStroke: string
}

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function truncateLabel(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function numericStyleValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function buildDynamicInputs(battery: Battery, pipelineNode: PipelineNode): ExportPort[] {
  const cfg = battery.dynamicInputs
  if (!cfg) return []
  const count = typeof pipelineNode.params?.portCount === 'number'
    ? Math.max(cfg.minCount, pipelineNode.params.portCount)
    : cfg.minCount
  return Array.from({ length: count }, (_, i) => ({
    name: `${cfg.prefix}${i}`,
    type: cfg.type,
    label: cfg.labelTemplate.replace('$i', String(i)),
  }))
}

function buildDynamicOutputs(pipelineNode: PipelineNode): ExportPort[] {
  const ports = pipelineNode.params?._dynOutPorts
  if (!Array.isArray(ports)) return []
  return ports
    .filter((port): port is { name: string; type: string; label?: string } =>
      typeof port?.name === 'string' && typeof port?.type === 'string',
    )
    .map(port => ({ name: port.name, type: port.type, label: port.label }))
}

function portLabel(port: ExportPort): string {
  return port.labelEn || port.name
}

function visiblePorts(ports: ExportPort[]): ExportPort[] {
  return ports.filter(port => !port.hidden)
}

function groupPortToExport(port: NodeGroup['exposedInputs'][number]): ExportPort {
  return {
    name: port.portName,
    type: port.portType,
    label: port.customLabelEn || port.portLabelEn || port.sourcePortName || port.portName,
    labelEn: port.customLabelEn || port.portLabelEn || port.sourcePortName || port.portName,
    hidden: port.hidden,
  }
}

function getNodePorts(
  pipelineNode: PipelineNode,
  battery: Battery | undefined,
  group: NodeGroup | undefined,
): { inputs: ExportPort[]; outputs: ExportPort[] } {
  if (pipelineNode.batteryId === '__group__' && group) {
    return {
      inputs: visiblePorts(group.exposedInputs.map(groupPortToExport)),
      outputs: visiblePorts(group.exposedOutputs.map(groupPortToExport)),
    }
  }

  if (pipelineNode.batteryId === RELAY_BATTERY_ID) {
    const portType = typeof pipelineNode.params?.portType === 'string' ? pipelineNode.params.portType : 'any'
    return {
      inputs: [{ name: 'input', type: portType, label: 'input' }],
      outputs: [{ name: 'output', type: portType, label: 'output' }],
    }
  }

  if (!battery) return { inputs: [], outputs: [] }
  return {
    inputs: visiblePorts([...battery.inputs, ...buildDynamicInputs(battery, pipelineNode)]),
    outputs: visiblePorts([...battery.outputs, ...buildDynamicOutputs(pipelineNode)]),
  }
}

function fallbackNodeTheme(kind: ExportNodeView['kind']): NodeVisualTheme {
  if (kind === 'group') return { fill: '#0f2f2b', header: '#134e4a', stroke: '#2dd4bf', titleColor: EXPORT_TEXT_COLOR, portColor: EXPORT_TEXT_COLOR }
  if (kind === 'relay') return { fill: '#111827', header: '#1f2937', stroke: '#94a3b8', titleColor: EXPORT_TEXT_COLOR, portColor: EXPORT_TEXT_COLOR }
  return { fill: '#152312', header: '#263f18', stroke: '#a3e635', titleColor: EXPORT_TEXT_COLOR, portColor: EXPORT_TEXT_COLOR }
}

function fallbackFrameTheme(): FrameVisualTheme {
  return {
    titleFill: '#0f172a',
    titleStroke: '#7dd3fc',
    titleColor: FRAME_TITLE_TEXT_COLOR,
    frameFill: 'none',
    frameStroke: '#bae6fd',
  }
}

function isPaintedColor(value: string | undefined): value is string {
  if (!value || value === 'transparent') return false
  return !/^rgba\([^)]*,\s*0\)$/i.test(value.trim())
}

function findRfNodeElement(nodeId: string): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))
  return nodes.find(node => node.getAttribute('data-id') === nodeId) ?? null
}

function getDomNodeSize(nodeId: string): { width: number; height: number } | null {
  const wrapper = findRfNodeElement(nodeId)
  const body = wrapper?.firstElementChild instanceof HTMLElement ? wrapper.firstElementChild : wrapper
  if (!body) return null
  if (body.offsetWidth <= 0 || body.offsetHeight <= 0) return null
  return { width: body.offsetWidth, height: body.offsetHeight }
}

function getRfNodeSize(node: Node): { width: number; height: number } {
  const domSize = getDomNodeSize(node.id)
  if (domSize) return domSize
  return {
    width: node.width ?? numericStyleValue(node.style?.width) ?? FALLBACK_NODE_WIDTH,
    height: node.height ?? numericStyleValue(node.style?.height) ?? FALLBACK_NODE_HEIGHT,
  }
}

function getFirstElement(root: HTMLElement | null, selectors: string[]): HTMLElement | null {
  if (!root) return null
  for (const selector of selectors) {
    const match = root.querySelector<HTMLElement>(selector)
    if (match) return match
  }
  return null
}

function readNodeTheme(nodeId: string, kind: ExportNodeView['kind']): NodeVisualTheme {
  const fallback = fallbackNodeTheme(kind)
  const wrapper = findRfNodeElement(nodeId)
  const body = wrapper?.firstElementChild instanceof HTMLElement ? wrapper.firstElementChild : wrapper
  const header = getFirstElement(body, ['.node-header', '.group-header', '.group-node-header', '.relay-node__core'])

  const bodyStyle = body ? getComputedStyle(body) : null
  const headerStyle = header ? getComputedStyle(header) : null

  const fill = bodyStyle && isPaintedColor(bodyStyle.backgroundColor) ? bodyStyle.backgroundColor : fallback.fill
  const headerFill = headerStyle && isPaintedColor(headerStyle.backgroundColor) ? headerStyle.backgroundColor : fallback.header
  const stroke = bodyStyle && isPaintedColor(bodyStyle.borderTopColor) ? bodyStyle.borderTopColor : fallback.stroke

  return { fill, header: headerFill, stroke, titleColor: EXPORT_TEXT_COLOR, portColor: EXPORT_TEXT_COLOR }
}

function readFrameTheme(frameId: string): FrameVisualTheme {
  const fallback = fallbackFrameTheme()
  const wrapper = findRfNodeElement(frameId)
  const frameNode = wrapper?.firstElementChild instanceof HTMLElement ? wrapper.firstElementChild : wrapper
  const titleInput = getFirstElement(frameNode, ['.canvas-frame-title-input'])
  const frameStyle = frameNode ? getComputedStyle(frameNode) : null
  const titleStyle = titleInput ? getComputedStyle(titleInput) : null

  return {
    titleFill: titleStyle && isPaintedColor(titleStyle.backgroundColor) ? titleStyle.backgroundColor : fallback.titleFill,
    titleStroke: titleStyle && isPaintedColor(titleStyle.borderTopColor) ? titleStyle.borderTopColor : fallback.titleStroke,
    titleColor: FRAME_TITLE_TEXT_COLOR,
    frameFill: 'none',
    frameStroke: frameStyle && isPaintedColor(frameStyle.borderTopColor) ? frameStyle.borderTopColor : fallback.frameStroke,
  }
}

function portY(node: ExportNodeView, portName: string, side: 'input' | 'output'): number {
  const ports = side === 'input' ? node.inputs : node.outputs
  const index = ports.findIndex(port => port.name === portName)
  if (index < 0) return node.y + node.height / 2
  return node.y + HEADER_HEIGHT + 14 + index * PORT_ROW_HEIGHT
}

function makeNodeViews(input: FrameSvgExportInput, frame: CanvasFrame): ExportNodeView[] {
  const memberIds = new Set(frame.nodeIds)
  const rfById = new Map(input.rfNodes.map(node => [node.id, node]))

  return input.pipeline.nodes
    .filter(node => memberIds.has(node.id))
    .map(pipelineNode => {
      const rfNode = rfById.get(pipelineNode.id)
      const battery = input.batteries.find(item => item.id === pipelineNode.batteryId)
      const groupId = typeof pipelineNode.params?.groupId === 'string' ? pipelineNode.params.groupId : undefined
      const group = groupId ? input.pipeline.groups?.find(item => item.id === groupId) : undefined
      const { inputs, outputs } = getNodePorts(pipelineNode, battery, group)
      const measured = rfNode ? getRfNodeSize(rfNode) : { width: FALLBACK_NODE_WIDTH, height: FALLBACK_NODE_HEIGHT }
      const kind: ExportNodeView['kind'] = pipelineNode.batteryId === '__group__'
        ? 'group'
        : pipelineNode.batteryId === RELAY_BATTERY_ID ? 'relay' : 'battery'

      return {
        id: pipelineNode.id,
        x: SVG_PAD + ((rfNode?.position.x ?? pipelineNode.position.x) - frame.position.x),
        y: SVG_PAD + TITLE_BAND + ((rfNode?.position.y ?? pipelineNode.position.y) - frame.position.y),
        width: measured.width,
        height: measured.height,
        title: group?.nameEn || group?.name || battery?.nameEn || battery?.id || pipelineNode.name || pipelineNode.id,
        kind,
        inputs,
        outputs,
        theme: readNodeTheme(pipelineNode.id, kind),
      }
    })
}

function renderEdges(pipeline: Pipeline, frame: CanvasFrame, nodeViews: ExportNodeView[], domainPortTypes?: DomainPortTypes): string {
  const memberIds = new Set(frame.nodeIds)
  const viewById = new Map(nodeViews.map(node => [node.id, node]))

  return pipeline.edges
    .filter(edge => memberIds.has(edge.source.nodeId) && memberIds.has(edge.target.nodeId))
    .map(edge => {
      const source = viewById.get(edge.source.nodeId)
      const target = viewById.get(edge.target.nodeId)
      if (!source || !target) return ''

      const sourcePort = source.outputs.find(port => port.name === edge.source.port)
      const color = getPortTypeColor(sourcePort?.type ?? 'any', domainPortTypes)
      const x1 = source.x + source.width
      const y1 = portY(source, edge.source.port, 'output')
      const x2 = target.x
      const y2 = portY(target, edge.target.port, 'input')
      const dx = Math.max(48, Math.abs(x2 - x1) * 0.45)

      return `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${xml(color)}" stroke-width="2.4" stroke-linecap="round" opacity="0.88"/>`
    })
    .join('\n')
}

function renderNode(node: ExportNodeView, domainPortTypes?: DomainPortTypes): string {
  const theme = node.theme
  const inputPorts = node.inputs.map((port, i) => {
    const y = HEADER_HEIGHT + 14 + i * PORT_ROW_HEIGHT
    const color = getPortTypeColor(port.type, domainPortTypes)
    return `<circle cx="0" cy="${y}" r="4.5" fill="${xml(color)}"/><text x="12" y="${y + 4}" class="port-text" fill="${xml(node.theme.portColor)}">${xml(truncateLabel(portLabel(port), 18))}</text>`
  }).join('\n')

  const outputPorts = node.outputs.map((port, i) => {
    const y = HEADER_HEIGHT + 14 + i * PORT_ROW_HEIGHT
    const color = getPortTypeColor(port.type, domainPortTypes)
    return `<circle cx="${node.width}" cy="${y}" r="4.5" fill="${xml(color)}"/><text x="${node.width - 12}" y="${y + 4}" text-anchor="end" class="port-text" fill="${xml(node.theme.portColor)}">${xml(truncateLabel(portLabel(port), 18))}</text>`
  }).join('\n')

  return `
<g transform="translate(${node.x} ${node.y})">
  <rect x="0" y="0" width="${node.width}" height="${node.height}" rx="9" fill="${theme.fill}" stroke="${theme.stroke}" stroke-width="1.8"/>
  <rect x="0" y="0" width="${node.width}" height="${HEADER_HEIGHT}" rx="9" fill="${theme.header}" opacity="0.96"/>
  <path d="M 0 ${HEADER_HEIGHT} H ${node.width}" stroke="${theme.stroke}" stroke-width="1" opacity="0.45"/>
  <text x="12" y="20" class="node-title" fill="${xml(theme.titleColor)}">${xml(truncateLabel(node.title, 30))}</text>
  ${inputPorts}
  ${outputPorts}
</g>`
}

export function buildFrameSvg(input: FrameSvgExportInput): string {
  const frame = input.pipeline.frames?.find(item => item.id === input.frameId)
  if (!frame) {
    throw new Error('Frame not found')
  }

  const nodeViews = makeNodeViews(input, frame)
  const frameTheme = readFrameTheme(frame.id)
  const svgWidth = Math.ceil(frame.width + SVG_PAD * 2)
  const svgHeight = Math.ceil(frame.height + SVG_PAD * 2 + TITLE_BAND)
  const frameX = SVG_PAD
  const frameY = SVG_PAD + TITLE_BAND

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <style>
    .node-title { font: 600 13px Inter, Arial, sans-serif; }
    .port-text { font: 11px Inter, Arial, sans-serif; }
    .frame-title { font: 700 14px Inter, Arial, sans-serif; letter-spacing: 0.02em; }
  </style>
  <rect x="${frameX}" y="${frameY}" width="${frame.width}" height="${frame.height}" rx="18" fill="${xml(frameTheme.frameFill)}" stroke="${xml(frameTheme.frameStroke)}" stroke-width="3" stroke-dasharray="7 5"/>
  <rect x="${frameX + 18}" y="${frameY - 34}" width="${Math.max(150, Math.min(frame.width - 36, frame.name.length * 9 + 52))}" height="28" rx="14" fill="${xml(frameTheme.titleFill)}" stroke="${xml(frameTheme.titleStroke)}" stroke-width="1.2"/>
  <text x="${frameX + 34}" y="${frameY - 15}" class="frame-title" fill="${xml(frameTheme.titleColor)}">${xml(truncateLabel(frame.name || 'Frame', 42))}</text>
  ${renderEdges(input.pipeline, frame, nodeViews, input.domainPortTypes)}
  ${nodeViews.map(node => renderNode(node, input.domainPortTypes)).join('\n')}
</svg>`
}

function svgToClipboardHtml(svg: string): string {
  return svg.replace(/^<\?xml[^>]*>\s*/i, '')
}

async function copyPlainText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to execCommand. It still works in some Electron/WebView
      // contexts where async clipboard writes are denied.
    }
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', 'true')
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.style.top = '0'
  document.body.appendChild(textArea)
  textArea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textArea)
  if (!ok) {
    throw new Error('Clipboard copy command failed')
  }
}

export async function copyFrameSvgToClipboard(input: FrameSvgExportInput): Promise<FrameExportClipboardMode> {
  const svg = buildFrameSvg(input)
  const html = svgToClipboardHtml(svg)

  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const canWriteSvgImage = typeof ClipboardItem.supports === 'function'
      && ClipboardItem.supports('image/svg+xml')

    if (canWriteSvgImage) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }),
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([svg], { type: 'text/plain' }),
          }),
        ])
        return 'image/svg+xml'
      } catch {
        // Some WebViews report support but still reject image/svg+xml writes.
        // Continue to inline SVG HTML, which remains vector-based when pasted
        // into HTML-aware targets.
      }
    }

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([svg], { type: 'text/plain' }),
        }),
      ])
      return 'text/html'
    } catch {
      await copyPlainText(svg)
      return 'text/plain'
    }
  }

  await copyPlainText(svg)
  return 'text/plain'
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to render frame SVG'))
    }
    image.src = url
  })
}

function scaleSvgForRaster(svg: string, scale: number): string {
  const widthMatch = svg.match(/<svg\b[^>]*\bwidth="([\d.]+)"/)
  const heightMatch = svg.match(/<svg\b[^>]*\bheight="([\d.]+)"/)
  const width = widthMatch ? Number.parseFloat(widthMatch[1]) : NaN
  const height = heightMatch ? Number.parseFloat(heightMatch[1]) : NaN
  if (!Number.isFinite(width) || !Number.isFinite(height)) return svg

  return svg
    .replace(/\bwidth="[\d.]+"/, `width="${Math.ceil(width * scale)}"`)
    .replace(/\bheight="[\d.]+"/, `height="${Math.ceil(height * scale)}"`)
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Failed to create PNG blob'))
      }
    }, 'image/png')
  })
}

export async function copyFramePngToClipboard(input: FrameSvgExportInput): Promise<FrameExportClipboardMode> {
  const svg = buildFrameSvg(input)
  const image = await loadSvgImage(scaleSvgForRaster(svg, PNG_RASTER_SCALE))
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable')
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  const png = await canvasToPngBlob(canvas)
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': png,
      }),
    ])
    return 'image/png'
  }

  await copyPlainText(svg)
  return 'text/plain'
}
