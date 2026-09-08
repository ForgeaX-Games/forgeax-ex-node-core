// Bottom status bar: shows backend connection status, pipeline run status, the
// currently selected node, and aggregate node/edge counts.
//
// Ported faithfully from the legacy editor (components/common/StatusBar.tsx);
// store imports retargeted to ../../stores. No app-level coupling here.
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import './StatusBar.css'

function StatusBar() {
  const { currentPipeline, pipelineStatus, selectedNode, batteries } = usePipelineStore()
  const { connectionStatus, langMode } = useUIStore()
  const en = langMode === 'en'

  const nodeCount = currentPipeline?.nodes.length || 0
  const edgeCount = currentPipeline?.edges.length || 0

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <div className="status-item">
          <span className={`connection-indicator ${connectionStatus}`} />
          <span>{connectionStatus === 'connected' ? (en ? 'Connected' : '已连接') : connectionStatus === 'connecting' ? (en ? 'Connecting…' : '连接中...') : (en ? 'Disconnected' : '未连接')}</span>
        </div>
        {pipelineStatus !== 'idle' && (
          <div className="status-item">
            <span className={`status-badge status-${pipelineStatus}`}>
              {pipelineStatus === 'running' ? (en ? 'Running' : '运行中') : pipelineStatus === 'completed' ? (en ? 'Completed' : '已完成') : (en ? 'Error' : '错误')}
            </span>
          </div>
        )}
      </div>

      <div className="statusbar-center">
        {selectedNode && (
          <span className="selected-info">
            {en ? 'Selected:' : '选中:'}{' '}
            {en
              ? formatIdAsLabel(batteries.find(b => b.id === selectedNode.batteryId)?.id ?? selectedNode.batteryId)
              : selectedNode.name}
          </span>
        )}
      </div>

      <div className="statusbar-right">
        <div className="status-item">
          <span>{en ? 'Nodes:' : '节点:'} {nodeCount}</span>
        </div>
        <div className="status-item">
          <span>{en ? 'Edges:' : '连接:'} {edgeCount}</span>
        </div>
      </div>
    </div>
  )
}

export default StatusBar
