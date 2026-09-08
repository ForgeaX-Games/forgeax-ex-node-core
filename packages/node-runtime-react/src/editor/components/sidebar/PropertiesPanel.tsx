// 💡 侧边栏属性面板组件：提供节点详情、运行日志和编译信息的选项卡式查看界面
// 忠实移植说明（faithful port）：原 lucide-react 图标（X / Info / FileText / Code）
// 替换为内联 SVG，保持包零依赖；markup / CSS class 与 size API 全部保留。
import { useState } from 'react'
import { useUIStore } from '../../stores/index.js'
import { usePipelineStore } from '../../stores/index.js'
import './Sidebar.css'

type IconProps = { size?: number; className?: string }

/** 内联图标基座：统一 lucide 风格（24 viewBox / stroke=currentColor / round）。 */
function svgIconProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true as const,
  }
}

function X({ size = 16, className }: IconProps) {
  return (
    <svg {...svgIconProps(size, className)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function Info({ size = 16, className }: IconProps) {
  return (
    <svg {...svgIconProps(size, className)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

function FileText({ size = 16, className }: IconProps) {
  return (
    <svg {...svgIconProps(size, className)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function Code({ size = 16, className }: IconProps) {
  return (
    <svg {...svgIconProps(size, className)}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

type TabType = 'nodeInfo' | 'logs' | 'compile'

function PropertiesPanel() {
  // 从 UI 状态中拿到关闭侧边栏的方法
  const { toggleSidebar } = useUIStore()
  // 精确 selector：只在各自字段变化时重渲染，滑条拖动不触发节点未选中时的重渲染
  const selectedNode = usePipelineStore(s => s.selectedNode)
  const logs         = usePipelineStore(s => s.logs)
  const compileInfo  = usePipelineStore(s => s.compileInfo)
  // 本地管理标签栏的高亮状态，默认为显示节点信息
  const [activeTab, setActiveTab] = useState<TabType>('nodeInfo')

  // 定义属性面板顶部用于切换视图的选项卡数组配置
  const tabs: { id: TabType; icon: typeof Info; label: string }[] = [
    { id: 'nodeInfo', icon: Info, label: '节点信息' },
    { id: 'logs', icon: FileText, label: '日志' },
    { id: 'compile', icon: Code, label: '编译信息' }
  ]

  // UI 面板渲染部分
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`sidebar-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
            >
              <tab.icon size={16} />
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
        {/* 侧边栏关闭按钮 */}
        <button className="sidebar-close" onClick={toggleSidebar} title="关闭侧边栏">
          <X size={16} />
        </button>
      </div>

      <div className="sidebar-content">
        {/* 根据 activeTab 的状态按需挂载并渲染下方的详情内容 */}
        {activeTab === 'nodeInfo' && <NodeInfoTab node={selectedNode} />}
        {activeTab === 'logs' && <LogsTab logs={logs} />}
        {activeTab === 'compile' && <CompileTab compileInfo={compileInfo} />}
      </div>
    </div>
  )
}

interface NodeInfoTabProps {
  node: {
    id: string
    batteryId: string
    name: string
    position: { x: number; y: number }
    params: Record<string, unknown>
  } | null
}

// 节点详细信息选项卡，当选中节点存在时，依次列出它的基本信息（名称、ID、电池类型）、包含在 params 中的所有配置参数（以只读文本框显示），以及预留的输出信息区域
function NodeInfoTab({ node }: NodeInfoTabProps) {
  if (!node) {
    return (
      <div className="sidebar-empty">
        <Info size={32} className="empty-icon" />
        <p>选择一个节点以查看信息</p>
      </div>
    )
  }

  return (
    <div className="node-info-panel">
      {/* 第一部分：渲染节点固有的识别信息 */}
      <div className="info-section">
        <h4 className="section-title">基本信息</h4>
        <div className="info-row">
          <label>节点名称</label>
          <span>{node.name}</span>
        </div>
        <div className="info-row">
          <label>节点ID</label>
          <span className="monospace">{node.id}</span>
        </div>
        <div className="info-row">
          <label>电池类型</label>
          <span>{node.batteryId}</span>
        </div>
      </div>

      {/* 第二部分：迭代该节点的 params 字典，为每个可配置参数显示对应的回显状态 */}
      <div className="info-section">
        <h4 className="section-title">输入参数</h4>
        {Object.keys(node.params || {}).length > 0 ? (
          Object.entries(node.params || {}).map(([key, value]) => (
            <div key={key} className="param-item">
              <label>{key}</label>
              <input
                type="text"
                value={String(value)}
                readOnly
              />
            </div>
          ))
        ) : (
          <p className="no-params">暂无可配置参数</p>
        )}
      </div>

      {/* 第三部分：预留为节点运行结果预览提供的占位结构 */}
      <div className="info-section">
        <h4 className="section-title">输出</h4>
        <p className="no-output">运行管线后显示输出结果</p>
      </div>
    </div>
  )
}

interface LogsTabProps {
  logs: string[]
}

// 日志视图选项卡，将传入的日志数组循环渲染出来；如果暂无日志，展示空状态及图标
function LogsTab({ logs }: LogsTabProps) {
  if (!logs || logs.length === 0) {
    return (
      <div className="sidebar-empty">
        <FileText size={32} className="empty-icon" />
        <p>暂无日志</p>
      </div>
    )
  }

  return (
    <div className="logs-panel">
      <div className="logs-content">
        {logs.map((log, index) => (
          <div key={index} className="log-line">
            {log}
          </div>
        ))}
      </div>
    </div>
  )
}

interface CompileTabProps {
  compileInfo: { status: string; message: string } | null
}

// 编译状态选项卡，提取传入状态对象内的状态码和错误/成功长文本信息进行高亮展示，支持空状态显示
function CompileTab({ compileInfo }: CompileTabProps) {
  if (!compileInfo) {
    return (
      <div className="sidebar-empty">
        <Code size={32} className="empty-icon" />
        <p>暂无编译信息</p>
      </div>
    )
  }

  return (
    <div className="compile-panel">
      <div className="compile-status">
        {/* 根据当前的返回状态（success/error/compiling），驱动指示灯的 class 并显示相应的本地化文字 */}
        <span className={`status-indicator status-${compileInfo.status}`} />
        <span className="status-text">
          {compileInfo.status === 'success' ? '编译成功' :
           compileInfo.status === 'error' ? '编译失败' : '编译中...'}
        </span>
      </div>
      {/* 错误堆栈等长文本的格式化输出块，通过 pre 标签保持源码缩进格式 */}
      {compileInfo.message && (
        <div className="compile-message">
          <pre>{compileInfo.message}</pre>
        </div>
      )}
    </div>
  )
}

// 对外暴露完整的属性设置侧边栏入口组件
export default PropertiesPanel
