// Save-group-as-battery dialog: enter a category (folder) and battery name, then
// save the collapsed group as a reusable battery. Ported from the legacy editor
// (components/canvas/GroupSaveDialog.tsx).
//
import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { NodeGroup } from '../../types.js'
import { usePipelineStore } from '../../stores/index.js'
import { useUIStore } from '../../stores/index.js'
import { getEditorTransport } from '../../transport/index.js'
import { collectNestedDependencies } from './groupViewUtils.js'
import './GroupSaveDialog.css'

interface GroupSaveDialogProps {
  group: NodeGroup
  onClose: () => void
  /** Save-success callback; receives the saved category + battery name. */
  onSaved?: (categoryName: string, batteryName: string) => void
}

export function GroupSaveDialog({ group, onClose, onSaved }: GroupSaveDialogProps) {
  const en = useUIStore((s) => s.langMode) === 'en'

  const [categories, setCategories] = useState<string[]>([])
  const [categoryInput, setCategoryInput] = useState('')
  const [batteryName, setBatteryName] = useState(group.name || (en ? 'Group Node' : '组合节点'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const categoryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getEditorTransport().api.listTemplateCategories()
      .then((cats) => setCategories([...cats].sort()))
      .catch(() => {
        const cats = Array.from(
          new Set(
            usePipelineStore
              .getState()
              .batteries.filter((b) => b.type === 'group' && b.category)
              .map((b) => b.category as string),
          ),
        ).sort()
        setCategories(cats)
      })
    setTimeout(() => categoryInputRef.current?.focus(), 50)
  }, [])

  const handleSave = useCallback(async () => {
    const cat = categoryInput.trim()
    const name = batteryName.trim()
    if (!cat) { setError(en ? 'Category name is required' : '请填写标签名'); return }
    if (!name) { setError(en ? 'Battery name is required' : '请填写电池名'); return }

    setSaving(true)
    setError('')
    try {
      // Update the in-memory group name so the optimistic update shows it correctly.
      const { renameGroup, batteries, setBatteries, currentPipeline } = usePipelineStore.getState()
      renameGroup(group.id, name)

      // Collect nested dependencies (recursive __group__ children) and bundle them
      // into _nestedGroups so the saved group is self-contained on reload.
      const lookup = (gid: string) => (currentPipeline?.groups ?? []).find((g) => g.id === gid)
      const nested = collectNestedDependencies(group, lookup)
      const groupToSave: NodeGroup = nested.length > 0 ? { ...group, _nestedGroups: nested } : group

      const savedGroup = { ...groupToSave, name, nameEn: name }
      await getEditorTransport().api.saveGroupTemplate({
        group: savedGroup,
        categoryName: cat,
        batteryName: name,
      })

      // Optimistic update: inject the saved group into the battery catalog so it
      // appears in the BatteryBar immediately.
      const existingIdx = batteries.findIndex((b) => b.id === group.id)
      const groupBattery = {
        id: group.id,
        name,
        nameEn: name,
        type: 'group' as const,
        category: cat,
        // 普通成组电池归入 GROUPS 大标签、按 cat 分二级小标签（与后端 list 的
        // displayGroup `groups/<cat>` 一致），保证乐观插入即落在 Develop/GROUPS。
        displayGroup: `groups/${cat}`,
        description: en ? `Group battery: ${name}` : `成组电池：${name}`,
        version: '1.0.0',
        inputs: [],
        outputs: [],
        params: [],
      }
      if (existingIdx >= 0) {
        const updated = [...batteries]
        updated[existingIdx] = groupBattery
        setBatteries(updated)
      } else {
        setBatteries([...batteries, groupBattery])
      }

      onSaved?.(cat, name)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }, [categoryInput, batteryName, group, onSaved, onClose, en])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && !saving) void handleSave()
  }, [onClose, handleSave, saving])

  // Only close when the mousedown truly lands on the overlay itself. Otherwise,
  // dragging to select text inside an input and releasing outside the modal makes
  // the browser dispatch the click to the nearest common ancestor (the overlay),
  // which would mis-close the dialog mid-edit.
  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  return createPortal(
    <div className="gsd-overlay" onMouseDown={handleOverlayMouseDown} onKeyDown={handleKeyDown}>
      <div className="gsd-modal">
        <div className="gsd-header">
          <span className="gsd-title">{en ? 'Save Group Battery' : '保存成组电池'}</span>
          <button className="gsd-close" onClick={onClose}>✕</button>
        </div>

        <div className="gsd-body">
          <div className="gsd-field">
            <label className="gsd-label">{en ? 'Category (folder name)' : '标签名（分类文件夹）'}</label>
            <input
              ref={categoryInputRef}
              className="gsd-input"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              placeholder={en ? 'Enter new category or select below…' : '输入新分类或从下方选择…'}
              list="gsd-categories-list"
              onKeyDown={handleKeyDown}
            />
            <datalist id="gsd-categories-list">
              {categories.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
            {categories.length > 0 && (
              <div className="gsd-chips">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    className={`gsd-chip${categoryInput === cat ? ' gsd-chip--active' : ''}`}
                    onClick={() => setCategoryInput(cat)}
                    type="button"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="gsd-field">
            <label className="gsd-label">{en ? 'Battery name' : '电池名'}</label>
            <input
              className="gsd-input"
              value={batteryName}
              onChange={(e) => setBatteryName(e.target.value)}
              placeholder={en ? 'Enter battery name…' : '输入电池名称…'}
              onKeyDown={handleKeyDown}
            />
          </div>

          {error && <div className="gsd-error">{error}</div>}
        </div>

        <div className="gsd-footer">
          <button className="gsd-btn gsd-btn--cancel" onClick={onClose} disabled={saving}>{en ? 'Cancel' : '取消'}</button>
          <button className="gsd-btn gsd-btn--save" onClick={handleSave} disabled={saving}>
            {saving ? (en ? 'Saving…' : '保存中…') : (en ? 'Save' : '保存')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
