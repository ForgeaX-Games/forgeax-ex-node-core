// GridPanel special node: auto-detects grid data and renders the mask values as
// smoothed text in a compact rectangular grid. Ported from the legacy editor
// (components/canvas/GridPanelNode.tsx).
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps, NodeResizer, useReactFlow } from 'reactflow'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getPortTypeColor, normalizeType } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import {
  TooltipPortal,
  useNodeValueFormatters,
  useNodeTooltip,
  resolveInputPortValue,
  type BatteryTooltipState,
} from './nodeTooltip.js'
import './GridPanelNode.css'

interface GridPanelNodeData {
  battery: {
    id: string
    name: string
    type?: string
    nameEn?: string
    version?: string
    category?: string
    description?: string
    descriptionEn?: string
    inputs: Array<{ name: string; type: string; label?: string; description?: string; descriptionEn?: string; default?: unknown }>
    outputs: Array<{ name: string; type: string; label?: string; description?: string; descriptionEn?: string }>
  }
  params: Record<string, unknown>
}

// Each cell is a fixed 4x4 CSS px (visual size); rendered internally at SCALE
// physical resolution so the text stays crisp.
const CELL = 4
// Off-screen magnification: canvas physical pixels = CELL*SCALE, CSS size stays
// CELL, and after ctx.scale(SCALE) the coordinates are unchanged.
const SCALE = 4
// Node left/right padding (8*2) + handle reservations on both sides (14*2).
const PAD_H = 8 * 2 + 14 * 2
// Title bar height.
const HEADER_H = 22
// Body top/bottom padding.
const PAD_V = 6 * 2
// Gap + label between multiple grids.
const GAP_LABEL = 6 + 12

const MIN_NODE_W = 180


/**
 * Split a numeric string into 1-2 lines by max length.
 * maxLen <= 2 is a single line; otherwise split from the middle into two lines.
 */
function splitDigits(valStr: string, maxLen: number): string[] {
  if (maxLen <= 2) return [valStr]
  const half = Math.ceil(maxLen / 2)
  const padded = valStr.padStart(maxLen, '0')
  return [padded.slice(0, half), padded.slice(half)]
}

function isGrid2D(val: unknown): val is number[][] {
  if (!Array.isArray(val) || val.length === 0) return false
  const first = val[0]
  return Array.isArray(first) && first.length > 0 && typeof first[0] === 'number'
}

function isGrid3D(val: unknown): val is number[][][] {
  if (!Array.isArray(val) || val.length === 0) return false
  return isGrid2D(val[0])
}

function extractGrids(val: unknown): number[][][] | null {
  if (val === null || val === undefined) return null
  let parsed: unknown = val
  if (typeof val === 'string') {
    try { parsed = JSON.parse(val) } catch { return null }
  }
  if (isGrid3D(parsed)) return parsed as number[][][]
  if (isGrid2D(parsed)) return [parsed as number[][]]
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    for (const key of ['grid', 'outputGrid', 'regionGrid', 'waterGrid', 'roadGrid', 'mergedGrid']) {
      const sub = obj[key]
      if (sub === undefined) continue
      if (isGrid3D(sub)) return sub as number[][][]
      if (isGrid2D(sub)) return [sub as number[][]]
    }
  }
  return null
}

// Draw a single grid to a canvas.
// Physical resolution = logical size x SCALE; CSS size stays CELL px, and after
// ctx.scale(SCALE) the coordinate system is unchanged.
function drawGrid(canvas: HTMLCanvasElement, grid: number[][]) {
  const rows = grid.length
  const cols = Math.max(...grid.map(r => r.length))
  // CSS (logical) size.
  const cssW = cols * CELL
  const cssH = rows * CELL
  // Physical pixels = SCALE times, to give glyphs enough pixels.
  canvas.width  = cssW  * SCALE
  canvas.height = cssH * SCALE
  // CSS size keeps the visual dimensions.
  canvas.style.width  = `${cssW}px`
  canvas.style.height = `${cssH}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return // no 2d context (non-DOM/jsdom) — skip the raster draw
  // Scale the coordinate system; subsequent coords keep using CELL units.
  ctx.scale(SCALE, SCALE)

  // Scan all values to find the longest string (including a minus sign).
  let maxLen = 1
  for (const row of grid) {
    for (const v of row) {
      const len = String(v).length
      if (len > maxLen) maxLen = len
    }
  }

  // Very faint grid lines to delineate cells.
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 0.5
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(cols * CELL, r * CELL); ctx.stroke()
  }
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, rows * CELL); ctx.stroke()
  }

  // Render anti-aliased digits with fillText.
  // maxLen <= 2 single line, font size 55% of the cell; 3+ digits split two lines, 38%.
  const isTwoLine = maxLen > 2
  const fontSize = isTwoLine ? CELL * 0.38 : CELL * 0.55
  ctx.font = `${fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const v = grid[r][c]
      const cx = c * CELL + CELL / 2  // cell horizontal center
      const cy = r * CELL + CELL / 2  // cell vertical center
      ctx.fillStyle = v === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.88)'
      const lines = splitDigits(String(v), maxLen)
      if (lines.length === 1) {
        ctx.fillText(lines[0], cx, cy)
      } else {
        // Two lines: top at 30% of the cell, bottom at 70%.
        ctx.fillText(lines[0], cx, r * CELL + CELL * 0.3)
        ctx.fillText(lines[1], cx, r * CELL + CELL * 0.72)
      }
    }
  }
}

function GridPanelNode({ id, data, selected, dragging }: NodeProps<GridPanelNodeData>) {
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const nodeOutputs     = usePipelineStore((s) => s.nodeOutputs)
  const langMode        = useUIStore(s => s.langMode)
  const { setNodes }    = useReactFlow()
  const { tooltip, showImmediate, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)
  const { formatPortValue, formatPortValueExtra } = useNodeValueFormatters()

  const rawVal = nodeOutputs[id]?.grid ?? nodeOutputs[id]?.output ?? null
  const grids  = extractGrids(rawVal)

  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  // After a manual resize, stop auto-sizing (a stored value means it was dragged).
  const userResizedRef = useRef(typeof data.params._nodeWidth === 'number')
  // Actual content width, used as the NodeResizer minWidth (state ensures a
  // re-render on update).
  const [minNodeW, setMinNodeW] = useState(MIN_NODE_W)

  useEffect(() => {
    if (!grids) return

    let maxC = 0
    let totalR = 0
    grids.forEach(g => {
      g.forEach(row => { if (row.length > maxC) maxC = row.length })
      totalR += g.length
    })

    grids.forEach((grid, i) => {
      const canvas = canvasRefs.current[i]
      if (canvas) drawGrid(canvas, grid)
    })

    const gapExtra = grids.length > 1 ? (grids.length - 1) * GAP_LABEL : 0
    const contentW = maxC * CELL
    const contentH = totalR * CELL + gapExtra
    const nodeW = Math.max(MIN_NODE_W, contentW + PAD_H)
    const nodeH = contentH + PAD_V + HEADER_H

    // Always update the minimum width (so the user cannot drag narrower than the grid content).
    setMinNodeW(nodeW)

    // Auto-expand the node only on the first data arrival (user has not dragged).
    if (userResizedRef.current) return

    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, style: { ...n.style, width: nodeW, height: nodeH } } : n
    ))
    updateNodeParam(id, '_nodeWidth', nodeW, true)
    updateNodeParam(id, '_nodeHeight', nodeH, true)
  }, [grids, id, setNodes, updateNodeParam])

  const inputColor  = getPortTypeColor('any')
  const outputColor = getPortTypeColor('any')

  const showInputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const inp = data.battery.inputs[0]
    if (!inp) return
    const canonical = normalizeType(inp.type)
    const inputVal = resolveInputPortValue(id, inp.name)
    const valueLine = inputVal !== undefined
      ? { label: 'value:', text: formatPortValue(inputVal), extra: formatPortValueExtra(inputVal) }
      : inp.default !== undefined
        ? { label: 'default:', text: formatPortValue(inp.default), extra: formatPortValueExtra(inp.default), muted: true as const }
        : undefined
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (inp.label ?? inp.name) : inp.name,
      subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1),
      subtitleColor: getPortTypeColor(canonical),
      description: langMode === 'zh' ? inp.description : (inp.descriptionEn || inp.description),
      valueLine,
    })
  }, [id, langMode, data.battery.inputs, showImmediate])

  const showOutputPortTooltip = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const out = data.battery.outputs[0]
    if (!out) return
    const canonical = normalizeType(out.type)
    const outVal = usePipelineStore.getState().nodeOutputs[id]?.[out.name]
    const valueLine = outVal !== undefined
      ? { label: 'output:', text: formatPortValue(outVal), extra: formatPortValueExtra(outVal) }
      : { label: 'output:', text: langMode === 'zh' ? '暂无计算结果' : 'no result', muted: true as const }
    showImmediate({
      x: e.clientX + 16, y: e.clientY - 8,
      title: langMode === 'zh' ? (out.label ?? out.name) : out.name,
      subtitle: canonical.charAt(0).toUpperCase() + canonical.slice(1),
      subtitleColor: getPortTypeColor(canonical),
      description: langMode === 'zh' ? out.description : (out.descriptionEn || out.description),
      valueLine,
    })
  }, [id, langMode, data.battery.outputs, showImmediate])

  const showBatteryTooltip = useCallback(() => {
    showDelayed({
      title: langMode === 'zh' ? data.battery.name : formatIdAsLabel(data.battery.id),
      subtitle: data.battery.version ? `v${data.battery.version}` : undefined,
      tagLine: getBatteryTagLine(data.battery.type ?? '', data.battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(data.battery.type ?? ''),
      description: langMode === 'zh' ? data.battery.description : (data.battery.descriptionEn || data.battery.description),
    } satisfies BatteryTooltipState)
  }, [data.battery, langMode, showDelayed])

  return (
    <div
      className={['gp-node', selected ? 'selected' : ''].filter(Boolean).join(' ')}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      {/* NodeResizer kept (manual drag to inspect detail) but resets to content
          size when data changes. */}
      <NodeResizer
        minWidth={minNodeW}
        minHeight={60}
        isVisible={selected}
        lineClassName="gp-resize-line"
        handleClassName="gp-resize-handle"
        onResizeEnd={(_event, params) => {
          userResizedRef.current = true
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('grid-panel-resize')
        }}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ background: inputColor, border: `2px solid ${inputColor}`, width: 10, height: 10 }}
        onMouseEnter={showInputPortTooltip}
        onMouseLeave={hide}
      />

      <div className="gp-header">
        <span className="gp-title">
          {langMode === 'zh'
            ? (data.battery?.name || '网格预览')
            : formatIdAsLabel(data.battery?.id || 'grid_panel')}
        </span>
      </div>

      <div className="gp-body">
        {grids
          ? grids.map((grid, i) => (
              <div key={i} className="gp-grid-wrap">
                {grids.length > 1 && (
                  <span className="gp-grid-label">
                    [{i}] {grid.length}x{Math.max(...grid.map(r => r.length))}
                  </span>
                )}
                <canvas
                  className="gp-canvas"
                  ref={el => { canvasRefs.current[i] = el }}
                />
              </div>
            ))
          : <span className="gp-placeholder">
              {rawVal !== null && rawVal !== undefined
                ? (langMode === 'zh' ? '无法识别网格数据' : 'Unrecognized grid data')
                : (langMode === 'zh' ? '等待网格输入…' : 'Waiting for grid input…')}
            </span>
        }
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="grid"
        style={{ background: outputColor, border: `2px solid ${outputColor}`, width: 10, height: 10 }}
        onMouseEnter={showOutputPortTooltip}
        onMouseLeave={hide}
      />

      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
}

export default memo(GridPanelNode)
