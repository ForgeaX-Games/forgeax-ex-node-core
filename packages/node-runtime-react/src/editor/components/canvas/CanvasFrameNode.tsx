// Canvas frame node: a labelled boundary around a set of nodes with rename and
// PNG-to-clipboard export. Closing a frame is done from the frame context menu
// (useCanvasFrames.closeFrame); there is no explicit × button. The title bar
// auto-sizes to its label. Imports retargeted onto the editor stores + sibling
// frame-export util.
import { memo, useCallback, useEffect, useState } from 'react'
import { useReactFlow, type NodeProps } from 'reactflow'
import { usePipelineStore } from '../../stores/index.js'
import { copyFramePngToClipboard, type FrameExportClipboardMode } from './canvasFrameExport.js'
import type { DomainPortTypes } from '../../utils/portTypes.js'
import './CanvasFrameNode.css'

export interface CanvasFrameNodeData {
  name: string
  nodeIds: string[]
}

const FRAME_TITLE_MIN_WIDTH = 160
const FRAME_TITLE_INPUT_PAD_X = 24
const FRAME_TITLE_ACTION_WIDTH = 42
const FRAME_TITLE_ACTION_GAP = 6

// Rough per-character advance so the title bar grows with its label (CJK glyphs
// are wider than Latin). Avoids measuring the DOM on every keystroke.
function estimateFrameTitleTextWidth(text: string): number {
  return [...text].reduce((sum, char) => {
    return sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 13.5 : 7.4)
  }, 0)
}

function CanvasFrameNode({ id, data, selected, domainPortTypes }: NodeProps<CanvasFrameNodeData> & { domainPortTypes?: DomainPortTypes }) {
  const renameFrame = usePipelineStore(s => s.renameFrame)
  const addLog = usePipelineStore(s => s.addLog)
  // Defensive reads: a pasted/duplicated frame can briefly carry partial data.
  const frameName = typeof data?.name === 'string' ? data.name : 'Frame'
  const frameNodeIds = Array.isArray(data?.nodeIds) ? data.nodeIds : []
  const [localName, setLocalName] = useState(frameName)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [copyMode, setCopyMode] = useState<FrameExportClipboardMode | null>(null)
  const { setNodes, getNodes, getEdges } = useReactFlow()

  useEffect(() => {
    setLocalName(frameName)
  }, [frameName])

  const commitName = useCallback(() => {
    const nextName = localName.trim() || 'Frame'
    setLocalName(nextName)
    setNodes(nodes => nodes.map(node =>
      node.id === id ? { ...node, data: { ...node.data, name: nextName } } : node
    ))
    renameFrame(id, nextName)
  }, [id, localName, renameFrame, setNodes])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
      return
    }
    if (e.key === 'Escape') {
      setLocalName(frameName)
      e.currentTarget.blur()
    }
    e.stopPropagation()
  }, [frameName])

  const handleCopySvg = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const { currentPipeline, batteries } = usePipelineStore.getState()
    if (!currentPipeline) return

    void copyFramePngToClipboard({
      frameId: id,
      pipeline: currentPipeline,
      batteries,
      rfNodes: getNodes(),
      rfEdges: getEdges(),
      domainPortTypes,
    })
      .then((mode) => {
        setCopyMode(mode)
        setCopyState('copied')
        addLog(`Copied frame PNG to clipboard (${mode})`)
        window.setTimeout(() => setCopyState('idle'), 1200)
      })
      .catch((error) => {
        console.error('[CanvasFrameNode] copy frame PNG failed', error)
        window.alert('Failed to copy frame PNG to clipboard.')
      })
  }, [addLog, getEdges, getNodes, id, domainPortTypes])

  const inputWidth = Math.max(
    FRAME_TITLE_MIN_WIDTH,
    Math.ceil(estimateFrameTitleTextWidth(localName) + FRAME_TITLE_INPUT_PAD_X),
  )
  const titleWidth = inputWidth + FRAME_TITLE_ACTION_WIDTH + FRAME_TITLE_ACTION_GAP

  return (
    <div className={`canvas-frame-node ${selected ? 'canvas-frame-node--selected' : ''}`}>
      <div className="canvas-frame-title nodrag" style={{ width: titleWidth }}>
        <input
          className="canvas-frame-title-input"
          value={localName}
          onChange={e => setLocalName(e.target.value)}
          onBlur={commitName}
          onKeyDown={handleKeyDown}
          onMouseDown={e => e.stopPropagation()}
          title={`${frameNodeIds.length} node(s)`}
        />
        <button
          className={`canvas-frame-action-button nodrag${copyState === 'copied' ? ' canvas-frame-action-button--copied' : ''}`}
          type="button"
          title={copyMode ? `Copied as ${copyMode}` : 'Copy PNG to clipboard'}
          aria-label="Copy PNG to clipboard"
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onClick={handleCopySvg}
        >
          {copyState === 'copied' ? 'OK' : 'PNG'}
        </button>
      </div>
    </div>
  )
}

export default memo(CanvasFrameNode)
