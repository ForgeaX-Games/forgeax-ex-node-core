// Shared project sub-views — the building blocks for both the modal
// `ProjectsDialog` and the inline `ProjectPanel` (left side pane). Extracted so
// the project UI has a SINGLE implementation: a card (open / rename / delete),
// the new-project wizard, and the delete confirmation. Consumers compose these;
// they own no layout chrome beyond what the cards need.

import { useCallback, useEffect, useState } from 'react'
import { getEditorTransport } from '../../transport/index.js'
import { useProjectStore } from '../../stores/projectStore.js'
import type { ImportTemplate, ProjectMeta } from '@forgeax/node-runtime'
import './ProjectsDialog.css'

export function ProjectCard({
  project,
  isActive,
  isSwitching,
  lockLabel,
  onActivate,
  onRename,
  onRequestDelete,
}: {
  project: ProjectMeta
  isActive: boolean
  isSwitching: boolean
  /** When set, the project is held by an agent — render a "busy" badge. */
  lockLabel?: string | null
  onActivate: () => void
  onRename: (name: string) => void
  onRequestDelete: () => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(project.name)

  return (
    <div className={`proj-card${isActive ? ' proj-card--active' : ''}`}>
      <button type="button" className="proj-card__open" disabled={isSwitching} onClick={onActivate}>
        <span className="proj-card__type">{project.type}</span>
        {editing ? (
          <input
            className="proj-card__name-input"
            value={name}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false)
              if (name.trim() && name !== project.name) onRename(name.trim())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        ) : (
          <span className="proj-card__name">{project.name}</span>
        )}
        {isActive && <span className="proj-card__badge">active</span>}
        {lockLabel && <span className="proj-card__badge proj-card__badge--lock">{lockLabel}</span>}
      </button>
      <div className="proj-card__actions">
        <button type="button" className="proj-card__action" title="Rename" onClick={() => setEditing(true)}>
          Rename
        </button>
        <button type="button" className="proj-card__action proj-card__action--danger" title="Delete" onClick={onRequestDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

export function NewProjectWizard({
  defaultProjectType,
  defaultProjectName,
  onCancel,
  onCreated,
}: {
  defaultProjectType: string
  defaultProjectName: string
  onCancel: () => void
  onCreated: () => void
}): JSX.Element {
  const createProject = useProjectStore((s) => s.createProject)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fromTemplate, setFromTemplate] = useState('')
  const [templates, setTemplates] = useState<readonly ImportTemplate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getEditorTransport()
      .api.listImportTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  const submit = useCallback(async () => {
    if (!name.trim()) {
      setError('Project name is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createProject({
        type: defaultProjectType,
        name: name.trim(),
        description: description.trim() || undefined,
        fromTemplate: fromTemplate || undefined,
      })
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [name, description, fromTemplate, defaultProjectType, createProject, onCreated])

  return (
    <div className="proj-wizard">
      <header className="proj-modal__head">
        <h2>New project</h2>
      </header>
      <label className="proj-field">
        <span>Name</span>
        <input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={defaultProjectName} />
      </label>
      <label className="proj-field">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="(optional)" />
      </label>
      <label className="proj-field">
        <span>Template</span>
        <select value={fromTemplate} onChange={(e) => setFromTemplate(e.target.value)}>
          <option value="">Blank</option>
          {templates.map((t) => (
            <option key={t.path} value={t.path}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="proj-error">{error}</div>}
      <footer className="proj-modal__foot">
        <button type="button" className="proj-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="proj-btn proj-btn--primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Creating...' : 'Create and open'}
        </button>
      </footer>
    </div>
  )
}

export function DeleteProjectDialog({
  project,
  onCancel,
  onDone,
}: {
  project: ProjectMeta
  onCancel: () => void
  onDone: () => void
}): JSX.Element {
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const [policy, setPolicy] = useState<'detach' | 'delete'>('detach')
  const [busy, setBusy] = useState(false)

  const confirm = useCallback(async () => {
    setBusy(true)
    try {
      await deleteProject(project.id, policy)
      onDone()
    } finally {
      setBusy(false)
    }
  }, [deleteProject, project.id, policy, onDone])

  return (
    <div className="proj-delete">
      <header className="proj-modal__head">
        <h2>Delete "{project.name}"?</h2>
      </header>
      <p className="proj-delete__copy">
        This permanently removes the project's graph, history, and outputs. This cannot be undone.
      </p>
      <fieldset className="proj-delete__policy">
        <legend>Produced assets</legend>
        <label>
          <input type="radio" checked={policy === 'detach'} onChange={() => setPolicy('detach')} /> Keep assets (detach)
        </label>
        <label>
          <input type="radio" checked={policy === 'delete'} onChange={() => setPolicy('delete')} /> Delete produced assets
        </label>
      </fieldset>
      <footer className="proj-modal__foot">
        <button type="button" className="proj-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="proj-btn proj-btn--danger" onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Deleting...' : 'Delete project'}
        </button>
      </footer>
    </div>
  )
}
