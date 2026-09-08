// Top toolbar: the editor title slot, a Run/Stop execute control, a settings
// dropdown (language + data-probe toggles, dev-note-count toggle, optional
// save/open, status info, operation history, data-types legend), a probe-mode
// toggle, an injectable app-level actions slot, and a workbench-fullscreen
// toggle.
//
// Ported faithfully from the legacy editor (components/toolbar/Toolbar.tsx).
// App-level coupling is stripped:
//   - The legacy app-title ("Scene Generator") becomes an injectable `title`.
//   - The Render / AssetStore / Viewer embedded sub-app toggles, the project
//     picker, the Develop/Templates battery filter, and the workbench-focus
//     store are app-level; the consumer supplies them via the `actions` slot.
//   - Legacy file save/open used an app-level apiService + savePipelineAs /
//     loadPipelineFromFile. Here save/open are generic optional callbacks
//     (`onSave` / `onOpen`); the buttons only render when wired.
//   - Legacy auto-executed on every param change. We keep a generic Run/Stop
//     affordance wired to the transport via pipelineStore.executePipeline /
//     stopPipeline, with run state read from pipelineStatus.
//
// lucide-react icons are replaced by inline SVGs (dependency-free, matching
// S3/S4). Real CSS class names are preserved verbatim.
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import type { DomainPortTypes } from '../../utils/portTypes.js'
import { SettingsDataTypesPanel, SettingsHistoryPanel } from './EditorSettingsPanels.js'
import SettingsInfoPanel from './SettingsInfoPanel.js'
import './Toolbar.css'

type IconProps = { size?: number }

function svgIconProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
}

function Play({ size = 18 }: IconProps) {
  return (
    <svg {...svgIconProps(size)} fill="currentColor" stroke="none">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function Square({ size = 18 }: IconProps) {
  return (
    <svg {...svgIconProps(size)} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}

function Settings({ size = 18 }: IconProps) {
  return (
    <svg {...svgIconProps(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function Activity({ size = 13 }: IconProps) {
  return (
    <svg {...svgIconProps(size)}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function Languages({ size = 13 }: IconProps) {
  return (
    <svg {...svgIconProps(size)}>
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  )
}

function Save({ size = 13 }: IconProps) {
  return (
    <svg {...svgIconProps(size)}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

function FolderOpen({ size = 13 }: IconProps) {
  return (
    <svg {...svgIconProps(size)}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function Maximize2({ size = 18 }: IconProps) {
  return (
    <svg {...svgIconProps(size)}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function Minimize2({ size = 18 }: IconProps) {
  return (
    <svg {...svgIconProps(size)}>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

export interface ToolbarProps {
  /** Editor title shown on the left. App-specific; defaults to "Node Editor". */
  title?: ReactNode
  /**
   * Show the generic Run / Stop execute control. The legacy editor auto-executed
   * on every edit and had no explicit run button, so a faithful app (scene
   * generator) passes `false` to hide it; defaults to `true` for the generic
   * editor where an explicit run affordance is useful.
   */
  showRunControl?: boolean
  /**
   * App-level controls injected into the toolbar's right group (before the
   * settings button): the legacy Render / AssetStore / Viewer sub-app toggles,
   * a project picker, battery view-mode toggles, etc. The generic editor has
   * none of these, so the slot is empty by default.
   */
  actions?: ReactNode
  /** Generic save handler. When provided, a Save button appears in the settings menu. */
  onSave?: () => void
  /** Generic open handler. When provided, an Open button appears in the settings menu. */
  onOpen?: () => void
  /**
   * App-level buttons injected INSIDE the settings dropdown (the legacy editor
   * placed the Render / AssetStore / Viewer embed toggles here, not on the top
   * bar). Rendered in a `.settings-actions` grid below the Workspace toggles,
   * matching the legacy layout. Empty by default for the generic editor.
   */
  settingsActions?: ReactNode
  /**
   * App-level status sections injected into the settings Status panel, after the
   * generic Editor status block. The legacy editor aggregated Renderer /
   * AssetStore status here; the consumer supplies those domain sections.
   */
  settingsStatusExtra?: ReactNode
  /**
   * Workbench-fullscreen state + toggle. Both app-level (multi-pane workbench);
   * when omitted the fullscreen button is hidden.
   */
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  /** Domain port types for the settings data-types legend (per editor instance). */
  domainPortTypes?: DomainPortTypes
  /**
   * Show the settings (gear) dropdown button. Defaults to `true`. A host app
   * that re-surfaces the gear's controls elsewhere (e.g. in a side pane) passes
   * `false` to hide the in-toolbar entry point; the underlying stores/APIs are
   * unaffected, so those controls keep working from wherever they are mounted.
   */
  showSettingsButton?: boolean
}

function Toolbar({ title = 'Node Editor', showRunControl = true, actions, onSave, onOpen, settingsActions, settingsStatusExtra, isFullscreen, onToggleFullscreen, domainPortTypes, showSettingsButton = true }: ToolbarProps) {
  const { pipelineStatus, executePipeline, stopPipeline } = usePipelineStore()
  const {
    probeMode,
    toggleProbeMode,
    langMode,
    toggleLangMode,
    showDevNoteCount,
    toggleShowDevNoteCount,
    batteryFilterMode,
    setBatteryFilterMode,
  } = useUIStore()

  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showSettingsMenu) return
    const handler = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSettingsMenu])

  const en = langMode === 'en'
  const isRunning = pipelineStatus === 'running'

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="app-logo">
          <span className="logo-text">{title}</span>
        </div>
      </div>

      <div className="toolbar-right">
        <div className="toolbar-group">
          {/* Run / Stop execute affordance (legacy auto-executed; here explicit).
              Faithful apps hide it via showRunControl={false}. */}
          {showRunControl && (
            <>
              {isRunning ? (
                <button
                  className="toolbar-btn toolbar-btn-stop"
                  title={en ? 'Stop' : '停止'}
                  onClick={() => void stopPipeline()}
                >
                  <Square size={18} />
                </button>
              ) : (
                <button
                  className="toolbar-btn toolbar-btn-run"
                  title={en ? 'Run pipeline' : '运行管线'}
                  onClick={() => void executePipeline()}
                >
                  <Play size={18} />
                </button>
              )}

              <div className="toolbar-divider" />
            </>
          )}

          <button
            className={`toolbar-btn toolbar-btn-probe${probeMode ? ' active' : ''}`}
            title={en ? 'Data probe on wires' : '数据探针'}
            aria-pressed={probeMode}
            onClick={() => toggleProbeMode()}
          >
            <Activity size={18} />
          </button>

          <div
            className={`toolbar-filter-toggle${batteryFilterMode === 'templates' ? ' mode-templates' : ''}`}
            role="tablist"
            aria-label={en ? 'Battery view mode' : '电池视图模式'}
          >
            <button
              type="button"
              role="tab"
              aria-selected={batteryFilterMode === 'develop'}
              className={`toolbar-filter-toggle-btn${batteryFilterMode === 'develop' ? ' is-active' : ''}`}
              onClick={() => setBatteryFilterMode('develop')}
              title={en ? 'Show development batteries' : '显示开发电池'}
            >
              {en ? 'Develop' : '开发'}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={batteryFilterMode === 'templates'}
              className={`toolbar-filter-toggle-btn${batteryFilterMode === 'templates' ? ' is-active' : ''}`}
              onClick={() => setBatteryFilterMode('templates')}
              title={en ? 'Show template batteries' : '显示模板电池'}
            >
              {en ? 'Templates' : '模板'}
            </button>
          </div>

          {/* App-level controls injected by the consumer. */}
          {actions}

          {/* Settings dropdown. Hidden when the host re-surfaces its controls
              elsewhere (showSettingsButton={false}); the stores stay live. */}
          {showSettingsButton && (
          <div className="settings-container" ref={settingsMenuRef}>
            <button
              className={`toolbar-btn${showSettingsMenu ? ' active' : ''}`}
              title={en ? 'Settings' : '设置'}
              onClick={(e) => {
                e.stopPropagation()
                setShowSettingsMenu(v => !v)
              }}
            >
              <Settings size={18} />
            </button>
            {showSettingsMenu && (
              <div className="settings-dropdown">
                <div className="settings-dropdown-header">
                  {en ? 'Workspace' : '工作区'}
                </div>
                <div className="settings-checkboxes">
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={langMode === 'en'}
                      onChange={() => toggleLangMode()}
                    />
                    <Languages size={13} />
                    <span>{en ? 'English labels' : '英文显示'}</span>
                  </label>
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={probeMode}
                      onChange={() => toggleProbeMode()}
                    />
                    <Activity size={13} />
                    <span>{en ? 'Data probe on wires' : '数据探针'}</span>
                  </label>
                </div>
                {(onOpen || onSave) && (
                  <div className="settings-actions">
                    {onOpen && (
                      <button
                        className="settings-action-button"
                        onClick={() => {
                          setShowSettingsMenu(false)
                          onOpen()
                        }}
                        title={en ? 'Open pipeline' : '打开管线'}
                      >
                        <FolderOpen size={13} />
                        <span>{en ? 'Open' : '打开'}</span>
                      </button>
                    )}
                    {onSave && (
                      <button
                        className="settings-action-button"
                        onClick={() => {
                          setShowSettingsMenu(false)
                          onSave()
                        }}
                        title={en ? 'Save current pipeline' : '保存当前管线'}
                      >
                        <Save size={13} />
                        <span>{en ? 'Save' : '保存'}</span>
                      </button>
                    )}
                  </div>
                )}
                {/* App-level embed toggles (legacy Render / AssetStore / Viewer). */}
                {settingsActions && (
                  <div className="settings-actions">
                    {settingsActions}
                  </div>
                )}
                <div className="settings-dropdown-header">
                  {en ? 'Battery Bar' : '电池栏'}
                </div>
                <div className="settings-checkboxes">
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={showDevNoteCount}
                      onChange={() => toggleShowDevNoteCount()}
                    />
                    <span>{en ? 'Show dev note count badge' : '显示开发记录数量角标'}</span>
                  </label>
                </div>
                <div className="settings-dropdown-header settings-dropdown-header--section">
                  {en ? 'Status' : '信息'}
                </div>
                <SettingsInfoPanel />
                {settingsStatusExtra}
                <div className="settings-dropdown-header settings-dropdown-header--section">
                  {en ? 'History' : '操作历史'}
                </div>
                <div className="settings-panel settings-panel--history">
                  <SettingsHistoryPanel />
                </div>
                <div className="settings-dropdown-header settings-dropdown-header--section">
                  {en ? 'Data Types' : '数据类型'}
                </div>
                <div className="settings-panel settings-panel--datatypes">
                  <SettingsDataTypesPanel domainPortTypes={domainPortTypes} />
                </div>
              </div>
            )}
          </div>
          )}

          {/* Workbench fullscreen toggle — only when the consumer wires it. */}
          {onToggleFullscreen && (
            <button
              className={`toolbar-btn${isFullscreen ? ' active' : ''}`}
              title={isFullscreen
                ? (en ? 'Exit fullscreen' : '退出全屏')
                : (en ? 'Maximize editor' : '最大化编辑器')}
              onClick={onToggleFullscreen}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Toolbar
