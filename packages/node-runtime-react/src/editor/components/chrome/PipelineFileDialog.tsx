import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ImportTemplate } from '@forgeax/node-runtime'

export interface PipelineFileDialogProps {
  mode: 'open' | 'save'
  onClose: () => void
  listTemplates: () => Promise<readonly ImportTemplate[]>
  onImport: (template: ImportTemplate) => Promise<void>
  onExport: (name: string) => Promise<void>
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const panelStyle: CSSProperties = {
  width: 420,
  maxWidth: '90vw',
  maxHeight: '80vh',
  overflow: 'auto',
  background: '#1e1e24',
  color: '#e6e6ea',
  border: '1px solid #3a3a44',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
  font: '13px/1.4 system-ui, sans-serif',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid transparent',
}

export function PipelineFileDialog({ mode, onClose, listTemplates, onImport, onExport }: PipelineFileDialogProps): JSX.Element {
  const [templates, setTemplates] = useState<readonly ImportTemplate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    if (mode !== 'open') return
    let cancelled = false
    listTemplates()
      .then((t) => {
        if (!cancelled) setTemplates(t)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [mode, listTemplates])

  const doImport = useCallback(
    async (template: ImportTemplate) => {
      setBusy(true)
      setError(null)
      try {
        await onImport(template)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [onImport, onClose],
  )

  const doExport = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await onExport(name.trim())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [name, onExport, onClose])

  return (
    <div style={overlayStyle} onMouseDown={onClose} role="dialog" aria-modal="true">
      <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <strong>{mode === 'open' ? 'Open pipeline template' : 'Save pipeline as template'}</strong>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}>x</button>
        </div>

        {error && <div style={{ color: '#ff8080', marginBottom: 10 }}>{error}</div>}

        {mode === 'open' ? (
          <div>
            {templates === null && !error && <div style={{ opacity: 0.6 }}>Loading templates...</div>}
            {templates !== null && templates.length === 0 && (
              <div style={{ opacity: 0.6 }}>No templates found. Save the current graph first.</div>
            )}
            {templates?.map((t) => (
              <div
                key={`${t.source ?? ''}/${t.path}`}
                style={rowStyle}
                onClick={() => {
                  if (!busy) void doImport(t)
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a33')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span>{t.name}</span>
                <span style={{ opacity: 0.5, fontSize: 11 }}>{t.format ?? ''} - {t.source ?? 'templates'}</span>
              </div>
            ))}
            {busy && <div style={{ opacity: 0.6, marginTop: 10 }}>Importing...</div>}
          </div>
        ) : (
          <div>
            <label style={{ display: 'block', marginBottom: 6, opacity: 0.8 }}>Template name (blank = timestamp)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-pipeline"
              autoFocus
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #3a3a44', background: '#16161b', color: '#e6e6ea', marginBottom: 12 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #3a3a44', background: 'transparent', color: '#e6e6ea', cursor: 'pointer' }}>Cancel</button>
              <button type="button" disabled={busy} onClick={() => void doExport()} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#4a6cff', color: '#fff', cursor: 'pointer' }}>{busy ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
