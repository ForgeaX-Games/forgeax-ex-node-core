// Side-pane home for the controls that used to live in the toolbar gear menu.
//
// When a host hides the gear (<Editor showSettingsButton={false} editorSyncKey=…>),
// it mounts this panel in its side pane instead. The panel:
//   - drives Open / Save via the editor transport (mounts PipelineFileDialog);
//   - hosts the language + dev-note-count preference toggles (uiStore, synced
//     across iframes by the storage-event bridge);
//   - renders the live Status + operation-History via the editor sync bridge
//     (mirroring the center editor's stores across iframes);
//   - shows the data-types legend;
//   - exposes a plugin-specific `windowToggles` slot for embed/window buttons.
//
// All underlying state/APIs are unchanged — this is purely a relocated UI.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ImportTemplate } from '@forgeax/node-runtime'

import { useUIStore } from '../../stores/index.js'
import { getEditorTransport } from '../../transport/index.js'
import type { DomainPortTypes } from '../../utils/portTypes.js'
import { SettingsDataTypesPanel, SettingsHistoryPanel } from '../toolbar/EditorSettingsPanels.js'
import SettingsInfoPanel from '../toolbar/SettingsInfoPanel.js'
import { DevNoteCountToggle, LanguageToggle } from '../toolbar/SettingsToggles.js'
import { createEditorBridge, type EditorBridge, type EditorMirrorSnapshot } from '../../sync/editorBridge.js'
import { PipelineFileDialog } from './PipelineFileDialog.js'
import './EditorControlsPanel.css'

function iconProps(size: number) {
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

function FolderOpen({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function Save({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps(size)}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

export interface EditorControlsPanelProps {
  /** Must match the center `<Editor editorSyncKey>` so the bridge connects. */
  syncKey: string
  /** Domain port types for the data-types legend (e.g. scene / geometry). */
  domainPortTypes?: DomainPortTypes
  /** Plugin-specific embed/window toggle buttons, rendered in a Windows section. */
  windowToggles?: ReactNode
}

export function EditorControlsPanel({ syncKey, domainPortTypes, windowToggles }: EditorControlsPanelProps): JSX.Element {
  const langMode = useUIStore((s) => s.langMode)
  const en = langMode === 'en'

  const [mirror, setMirror] = useState<EditorMirrorSnapshot | null>(null)
  const bridgeRef = useRef<EditorBridge | null>(null)
  const [fileDialog, setFileDialog] = useState<'open' | 'save' | null>(null)

  // Subscribe to the center editor's live snapshot and ask for an immediate one.
  useEffect(() => {
    const bridge = createEditorBridge(syncKey)
    bridgeRef.current = bridge
    const off = bridge.onState(setMirror)
    bridge.sendCommand({ type: 'request-state' })
    return () => {
      off()
      bridge.close()
      bridgeRef.current = null
    }
  }, [syncKey])

  // Open / Save go through the same transport API the center pane uses; import
  // broadcasts graph:applied from the backend, so the canvas reloads live.
  const listTemplates = useCallback((): Promise<readonly ImportTemplate[]> => {
    return getEditorTransport().api.listImportTemplates()
  }, [])
  const importTemplate = useCallback(async (template: ImportTemplate): Promise<void> => {
    await getEditorTransport().api.importPipelineFile({
      path: template.path,
      source: template.source,
      options: { mode: 'replace', remapNodeIds: false, executeAfter: 'full', actor: 'ui:import', label: `Import ${template.name}` },
    })
  }, [])
  const exportTemplate = useCallback(async (name: string): Promise<void> => {
    await getEditorTransport().api.exportPipeline({ name })
  }, [])

  return (
    <div className="editor-controls-panel">
      <section className="editor-controls__section">
        <div className="editor-controls__title">{en ? 'Pipeline' : '管线'}</div>
        <div className="editor-controls__buttons">
          <button type="button" className="editor-controls__btn" onClick={() => setFileDialog('open')} title={en ? 'Open pipeline' : '打开管线'}>
            <FolderOpen size={14} />
            <span>{en ? 'Open' : '打开'}</span>
          </button>
          <button type="button" className="editor-controls__btn" onClick={() => setFileDialog('save')} title={en ? 'Save current pipeline' : '保存当前管线'}>
            <Save size={14} />
            <span>{en ? 'Save' : '保存'}</span>
          </button>
        </div>
      </section>

      <section className="editor-controls__section">
        <div className="editor-controls__title">{en ? 'Display' : '显示'}</div>
        <LanguageToggle />
        <DevNoteCountToggle />
      </section>

      {windowToggles && (
        <section className="editor-controls__section">
          <div className="editor-controls__title">{en ? 'Windows' : '窗口'}</div>
          <div className="editor-controls__buttons">{windowToggles}</div>
        </section>
      )}

      <section className="editor-controls__section">
        <div className="editor-controls__title">{en ? 'Status' : '状态'}</div>
        <SettingsInfoPanel mirror={mirror?.status} />
      </section>

      <section className="editor-controls__section">
        <div className="editor-controls__title">{en ? 'History' : '操作历史'}</div>
        <SettingsHistoryPanel
          mirror={mirror?.history}
          onClear={() => bridgeRef.current?.sendCommand({ type: 'clear-history' })}
        />
      </section>

      <section className="editor-controls__section">
        <div className="editor-controls__title">{en ? 'Data Types' : '数据类型'}</div>
        <SettingsDataTypesPanel domainPortTypes={domainPortTypes} />
      </section>

      {fileDialog && (
        <PipelineFileDialog
          mode={fileDialog}
          onClose={() => setFileDialog(null)}
          listTemplates={listTemplates}
          onImport={importTemplate}
          onExport={exportTemplate}
        />
      )}
    </div>
  )
}
