// Canvas annotation node: created by dropping an annotation battery. Single-click
// to select and drag, double-click to edit, blur to save. Ported from the legacy
// editor (components/canvas/AnnotationNode.tsx).
import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { type NodeProps, NodeResizer, useReactFlow } from 'reactflow'
import { usePipelineStore } from '../../stores/index.js'
import './AnnotationNode.css'

export interface AnnotationNodeData {
  /** Annotation text content. */
  text: string
  /** True when newly created so the node enters edit mode right after mount. */
  initialEdit?: boolean
}

// Add this class while editing so ReactFlow disables dragging.
const ANNOTATION_NO_DRAG_CLASS = 'nodrag'

// Font and line height (kept in sync with CSS, used for height estimation).
const FONT_SIZE = 26
const LINE_HEIGHT = 1.6
const PADDING_H = 12   // 6px each side (padding: 4px 6px)
const PADDING_V = 8    // 4px top/bottom
const DEFAULT_WIDTH = 400    // fixed layout width (kept after blur, does not shrink)

/**
 * Estimate the number of lines the text needs at the fixed constrainWidth (for
 * height calc). Used only for height; width always stays DEFAULT_WIDTH and never shrinks.
 */
function estimateHeight(text: string, innerWidth: number, ctx: CanvasRenderingContext2D): number {
  const rawLines = text.split('\n')
  let totalLines = 0

  for (const rawLine of rawLines) {
    if (rawLine === '') {
      totalLines += 1
      continue
    }
    const lineW = ctx.measureText(rawLine).width
    // ceil to round line count up, plus 1 as a safety margin against underestimation.
    totalLines += Math.max(1, Math.ceil(lineW / innerWidth))
  }

  return Math.ceil(totalLines * FONT_SIZE * LINE_HEIGHT)
}

function AnnotationNode({ id, data, selected }: NodeProps<AnnotationNodeData>) {
  const [isEditing, setIsEditing] = useState(data.initialEdit ?? false)
  const [localText, setLocalText] = useState(data.text ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const updateAnnotation = usePipelineStore(s => s.updateAnnotation)
  const removeAnnotation  = usePipelineStore(s => s.removeAnnotation)
  const { setNodes, getNode } = useReactFlow()

  // After entering edit mode, focus once the textarea has rendered.
  useEffect(() => {
    if (!isEditing) return
    const timer = setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const len = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(len, len)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [isEditing])

  // After exiting edit mode, adjust node height to the text (width always stays, no shrink).
  const fitNodeToText = useCallback((text: string) => {
    if (!text.trim()) return undefined

    const offscreen = document.createElement('canvas')
    const ctx = offscreen.getContext('2d')
    if (!ctx) return undefined
    ctx.font = `${FONT_SIZE}px sans-serif`

    const currentNode = getNode(id)
    const currentWidth = (currentNode?.style?.width as number | undefined) ?? DEFAULT_WIDTH
    const innerWidth = Math.max(40, currentWidth - PADDING_H)
    const height = estimateHeight(text, innerWidth, ctx)

    const newWidth  = currentWidth
    const newHeight = Math.max(40, height + PADDING_V)

    setNodes(nds => nds.map(n =>
      n.id === id ? { ...n, style: { ...n.style, width: newWidth, height: newHeight } } : n
    ))
    return { newWidth, newHeight }
  }, [id, setNodes, getNode])

  // Blur: save or remove, and auto-adjust node size.
  const handleBlur = useCallback(() => {
    setIsEditing(false)
    if (localText.trim() === '') {
      removeAnnotation(id)
      setNodes(nds => nds.filter(n => n.id !== id))
    } else {
      const dims = fitNodeToText(localText)
      updateAnnotation(id, localText, dims?.newWidth, dims?.newHeight)
    }
  }, [id, localText, updateAnnotation, removeAnnotation, setNodes, fitNodeToText])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalText(e.target.value)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      textareaRef.current?.blur()
    }
    // Stop Delete/Backspace from bubbling so ReactFlow does not delete the node.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation()
    }
  }, [])

  // Double-click: enter edit mode (stop bubbling to avoid the canvas double-click logic).
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
  }, [])

  // When the user finishes dragging the NodeResizer, persist the new size.
  const handleResizeEnd = useCallback((_: unknown, params: { width: number; height: number }) => {
    updateAnnotation(id, localText, params.width, params.height)
  }, [id, localText, updateAnnotation])

  return (
    <div
      className={[
        'annotation-node',
        selected ? 'annotation-node--selected' : '',
        isEditing ? `annotation-node--editing ${ANNOTATION_NO_DRAG_CLASS}` : '',
      ].join(' ').trim()}
      onDoubleClick={handleDoubleClick}
    >
      <NodeResizer
        minWidth={80}
        minHeight={32}
        isVisible={selected && !isEditing}
        lineClassName="annotation-resizer-line"
        handleClassName="annotation-resizer-handle"
        onResizeEnd={handleResizeEnd}
      />

      {isEditing ? (
        <textarea
          ref={textareaRef}
          className="annotation-textarea"
          value={localText}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Enter annotation..."
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        />
      ) : (
        <div className="annotation-text">
          {localText || <span className="annotation-placeholder">Double-click to edit</span>}
        </div>
      )}
    </div>
  )
}

export default memo(AnnotationNode)
