// Image reader node: node-editor style two-cell horizontal layout (name cell |
// image preview). Double-click the preview to open a file picker; on selection the
// image is uploaded to the asset library and previewed. Outputs an `image` type
// (an encoded ImageRef: alias + blobId) pointing at the stored asset. Ported from
// the legacy editor (components/canvas/ImageReaderNode.tsx).
//
// The library upload endpoint is configurable (defaults to the legacy path) so a
// consumer can point it at its own transport; the encode/preview path reuses the
// generic imageRef util.
import { memo, useState, useCallback, useRef, useMemo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { usePipelineStore, useUIStore, useHistoryStore } from '../../stores/index.js'
import { getPortTypeColor } from '../../utils/portTypes.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import { TooltipPortal, useNodeTooltip, type BatteryTooltipState } from './nodeTooltip.js'
import type { Battery } from '../../types.js'
import { encodeImageRef, imageRefToSrc } from '../../utils/imageRef.js'
import './ImageReaderNode.css'

interface ImageReaderNodeData {
  battery: Battery
  params: Record<string, unknown>
}

let libraryBase = '/api/v1/library'

/** Override the asset-library upload endpoint base used by ImageReaderNode. */
export function configureImageLibraryBase(base: string): void {
  libraryBase = base.replace(/\/+$/, '')
}

async function uploadToLibrary(file: File, alias: string): Promise<{ alias: string; blobId: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('alias', alias)
  const res = await fetch(`${libraryBase}/assets`, { method: 'POST', body: form })
  if (!res.ok) {
    const json = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(json.message || `Upload failed: ${res.status}`)
  }
  const json = await res.json()
  return { alias: json.data.alias as string, blobId: json.data.blobSha256 as string }
}

function ImageReaderNode({ id, data, selected, dragging }: NodeProps<ImageReaderNodeData>) {
  const { params } = data

  // Port string: an encoded ImageRef (JSON), e.g. `{"alias":"foo","blobId":"sha256..."}`.
  const [imageRef, setImageRef] = useState<string>(
    typeof params.imageRef === 'string' ? params.imageRef : ''
  )
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const edges = usePipelineStore(s => s.currentPipeline?.edges ?? [])
  const pipeNodes = usePipelineStore(s => s.currentPipeline?.nodes ?? [])
  const batteries = usePipelineStore(s => s.batteries)
  const langMode = useUIStore(s => s.langMode)
  const { tooltip, showDelayed, hide, trackMouse } = useNodeTooltip(1000, 500, dragging)

  const outputColor = getPortTypeColor('image')

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const { currentPipeline } = usePipelineStore.getState()
    if (currentPipeline) {
      useHistoryStore.getState().record('change_param', currentPipeline, {
        nodeIds: [id],
        label: `Select image: ${data.battery?.name ?? id} -> ${file.name}`,
        labelEn: `Select image: ${data.battery?.name ?? id} -> ${file.name}`,
      })
    }

    // Derive a stable alias from node id and filename (slugified).
    const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'image'
    const alias = `${baseName}-${id.slice(0, 8)}`

    setUploading(true)
    setUploadError(null)
    try {
      const uploaded = await uploadToLibrary(file, alias)
      const encoded = encodeImageRef({ alias: uploaded.alias, blobId: uploaded.blobId })
      setImageRef(encoded)
      updateNodeParam(id, 'imageRef', encoded)
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }, [id, updateNodeParam, data.battery])

  // Downstream label for the name cell.
  const downstreamLabel = useMemo(() => {
    const outEdges = edges.filter(e => e.source.nodeId === id)
    if (outEdges.length === 0) return null
    if (outEdges.length === 1) {
      const e = outEdges[0]
      const targetNode = pipeNodes.find(n => n.id === e.target.nodeId)
      if (!targetNode) return null
      const targetBattery = batteries.find(b => b.id === targetNode.batteryId)
      if (!targetBattery) return null
      const inputPort = targetBattery.inputs?.find(p => p.name === e.target.port)
      if (!inputPort) return null
      return langMode === 'zh' ? (inputPort.label || inputPort.name) : inputPort.name
    }
    const defaultName = langMode === 'zh'
      ? (data.battery?.name || '图像')
      : formatIdAsLabel(data.battery?.id || 'image_reader')
    return `${defaultName} x${outEdges.length}`
  }, [edges, pipeNodes, batteries, id, langMode, data.battery])

  const displayName = downstreamLabel ?? (langMode === 'zh'
    ? (data.battery?.name || '图像')
    : formatIdAsLabel(data.battery?.id || 'image_reader'))

  const showBatteryTooltip = useCallback(() => {
    const batteryDesc = langMode === 'zh'
      ? data.battery.description
      : (data.battery.descriptionEn || data.battery.description)
    showDelayed({
      title: langMode === 'zh' ? data.battery.name : formatIdAsLabel(data.battery.id),
      subtitle: data.battery.version ? `v${data.battery.version}` : undefined,
      tagLine: getBatteryTagLine(data.battery.type, data.battery.category ?? 'special'),
      tagLineColor: getBatteryTypeColor(data.battery.type),
      description: batteryDesc,
    } satisfies BatteryTooltipState)
  }, [data.battery, langMode, showDelayed])

  const thumbUrl = imageRefToSrc(imageRef)

  return (
    <div
      className={`ir-node${selected ? ' selected' : ''}`}
      onMouseEnter={showBatteryTooltip}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
    >
      {/* Left: name cell (drag region). */}
      <div className="ir-name-cell">
        <span className="ir-name">{displayName}</span>
      </div>

      {/* Right: image preview area (double-click to pick a file). */}
      <div
        className={`ir-preview-cell nodrag${thumbUrl ? ' has-image' : ''}`}
        onDoubleClick={handleDoubleClick}
      >
        {uploading ? (
          <div className="ir-placeholder">
            <div className="ir-uploading-spinner" />
            <span className="ir-hint">{langMode === 'zh' ? '上传中...' : 'Uploading...'}</span>
          </div>
        ) : thumbUrl ? (
          <img
            className="ir-preview-img"
            src={thumbUrl}
            alt="preview"
            draggable={false}
          />
        ) : (
          <div className="ir-placeholder">
            <svg className="ir-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10.5" r="1.5" />
              <path d="M3 17l4.5-4.5 3 3 3-3 4.5 4.5" />
            </svg>
            <span className="ir-hint">{langMode === 'zh' ? '双击选择图片' : 'Double-click to pick an image'}</span>
          </div>
        )}
        {uploadError && (
          <div className="ir-error" title={uploadError}>!</div>
        )}
      </div>

      {/* Hidden file input. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Output port — image type (asset alias). */}
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{
          background: outputColor,
          border: `2px solid ${outputColor}`,
          width: 10,
          height: 10,
        }}
      />

      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
}

export default memo(ImageReaderNode)
