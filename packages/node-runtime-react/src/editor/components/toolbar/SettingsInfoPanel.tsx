// Status-info block shown inside the settings dropdown: connection status,
// pipeline run status, the selected node, and node/edge counts.
//
// Ported faithfully from the legacy editor (components/toolbar/
// SettingsInfoPanel.tsx). The legacy panel also aggregated app-level Renderer
// and Asset Store status from a workbench-status store; that store and those
// two sections are app-level coupling and are stripped here, leaving the
// generic Editor section. Markup and CSS classes for the Editor section are
// preserved verbatim.
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import type { EditorStatusView } from '../../sync/editorBridge.js'
import './SettingsInfoPanel.css'

/**
 * Status info. By default reads the local pipeline + ui stores. When `mirror`
 * is supplied (side-pane mirror mode, fed by the editor sync bridge), it renders
 * from that snapshot instead — only `langMode` still comes from the local store
 * so the label language follows this pane's preference.
 */
function SettingsInfoPanel({ mirror }: { mirror?: EditorStatusView } = {}) {
  const local = usePipelineStore()
  const { connectionStatus: localConnection, langMode } = useUIStore()
  const en = langMode === 'en'

  const connectionStatus = mirror ? mirror.connectionStatus : localConnection
  const pipelineStatus = mirror ? mirror.pipelineStatus : local.pipelineStatus
  const nodeCount = mirror ? mirror.nodeCount : (local.currentPipeline?.nodes.length ?? 0)
  const edgeCount = mirror ? mirror.edgeCount : (local.currentPipeline?.edges.length ?? 0)

  const connectionLabel =
    connectionStatus === 'connected'
      ? (en ? 'Connected' : '已连接')
      : connectionStatus === 'connecting'
        ? (en ? 'Connecting…' : '连接中...')
        : (en ? 'Disconnected' : '未连接')

  const pipelineLabel =
    pipelineStatus === 'running'
      ? (en ? 'Running' : '运行中')
      : pipelineStatus === 'completed'
        ? (en ? 'Completed' : '已完成')
        : pipelineStatus === 'error'
          ? (en ? 'Error' : '错误')
          : null

  const selBatteryId = mirror ? mirror.selectedNodeBatteryId : (local.selectedNode?.batteryId ?? null)
  const selName = mirror ? mirror.selectedNodeName : (local.selectedNode?.name ?? null)
  // en label resolves from the battery id (the legacy `batteries.find(...)?.id`
  // lookup just returns the same id), so no battery catalog is needed here —
  // which is what lets this render correctly in a mirror-only side pane.
  const selectedLabel = (selBatteryId || selName)
    ? (en ? formatIdAsLabel(selBatteryId ?? '') : selName)
    : null

  return (
    <div className="settings-info-panel">
      <section className="settings-info-section">
        <div className="settings-info-section-title">{en ? 'Editor' : '编辑器'}</div>
        <div className="settings-info-rows">
          <div className="settings-info-row">
            <span className={`settings-info-dot settings-info-dot--${connectionStatus}`} />
            <span>{connectionLabel}</span>
          </div>
          {pipelineLabel && (
            <div className="settings-info-row">
              <span className={`settings-info-badge settings-info-badge--${pipelineStatus}`}>{pipelineLabel}</span>
            </div>
          )}
          {selectedLabel && (
            <div className="settings-info-row settings-info-row--muted">
              {en ? 'Selected:' : '选中:'} {selectedLabel}
            </div>
          )}
          <div className="settings-info-row settings-info-row--stats">
            <span>{en ? 'Nodes' : '节点'} {nodeCount}</span>
            <span className="settings-info-sep">·</span>
            <span>{en ? 'Edges' : '连接'} {edgeCount}</span>
          </div>
        </div>
      </section>
    </div>
  )
}

export default SettingsInfoPanel
