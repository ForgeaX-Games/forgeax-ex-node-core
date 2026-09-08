import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUIStore } from '../../stores/index.js'
import type { DevNoteEntry } from '../../stores/index.js'
import './DevNoteModal.css'

interface DevNoteModalProps {
  batteryId: string
  batteryName: string
  /** 同时存在多个弹窗时的序号，用于错开初始位置（每个弹窗偏移 24px） */
  index?: number
  onClose: () => void
}

const MODAL_WIDTH = 400
const MODAL_MAX_HEIGHT = 520
const STACK_OFFSET = 24
/** textarea 内容区最大高度，超出后出滚动条 */
const TEXTAREA_MAX_HEIGHT = 240

/** 生成当前时间的时间戳字符串，精确到分钟 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function DevNoteModal({ batteryId, batteryName, index = 0, onClose }: DevNoteModalProps) {
  const batteryDevNotes = useUIStore((s) => s.batteryDevNotes)
  const appendDevNote = useUIStore((s) => s.appendDevNote)
  const updateLastDevNote = useUIStore((s) => s.updateLastDevNote)
  const deleteLastDevNote = useUIStore((s) => s.deleteLastDevNote)
  const langMode = useUIStore((s) => s.langMode)

  // 本次打开新建的条目（挂载时初始化）
  const currentTsRef = useRef<number>(Date.now())
  // 时间戳固定部分（只读，灰色斜体展示）
  const timestampStr = formatTimestamp(currentTsRef.current)
  // 用户可在时间戳后追加的标题部分（初始为空）
  const [titleSuffix, setTitleSuffix] = useState('')
  const [currentContent, setCurrentContent] = useState('')

  // 挂载时：立即追加新条目到 store/后端（空内容占位，后续 update 更新）
  const hasAppendedRef = useRef(false)
  useEffect(() => {
    if (hasAppendedRef.current) return
    hasAppendedRef.current = true
    const entry: DevNoteEntry = {
      ts: currentTsRef.current,
      title: timestampStr,
      content: '',
    }
    appendDevNote(batteryId, entry)
  // 仅挂载时执行一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // textarea 自动撑高：记录当前高度（px），超过 TEXTAREA_MAX_HEIGHT 后锁定并出滚动条
  const [textareaHeight, setTextareaHeight] = useState<number | null>(null)
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentContent(e.target.value)
    // 先置 height:auto 让浏览器重算 scrollHeight，再根据上限决定最终高度
    const el = e.target
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)
    el.style.height = `${next}px`
    setTextareaHeight(next)
  }, [])

  // 弹窗位置：居中后按 index 错开，避免多弹窗完全重叠
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, (window.innerWidth - MODAL_WIDTH) / 2 + index * STACK_OFFSET),
    y: Math.max(0, (window.innerHeight - MODAL_MAX_HEIGHT) / 2 + index * STACK_OFFSET),
  }))

  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null)

  // header 鼠标按下开始拖拽
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    }
  }, [pos])

  // 拖拽移动
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      const currentH = modalRef.current?.offsetHeight ?? MODAL_MAX_HEIGHT
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - MODAL_WIDTH, dragRef.current.originX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - currentH, dragRef.current.originY + dy)),
      })
    }
    const onMouseUp = () => { dragRef.current = null }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // 挂载后自动滚到底部，并聚焦内容输入框
  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
      contentTextareaRef.current?.focus()
    })
  }, [])

  // 保存当前条目（失焦或关闭时触发）：标题 = 时间戳 + 用户追加部分
  const handleSave = useCallback(() => {
    const fullTitle = titleSuffix.trim()
      ? `${timestampStr} ${titleSuffix.trim()}`
      : timestampStr
    const entry: DevNoteEntry = {
      ts: currentTsRef.current,
      title: fullTitle,
      content: currentContent,
    }
    updateLastDevNote(batteryId, entry)
  }, [batteryId, timestampStr, titleSuffix, currentContent, updateLastDevNote])

  // 关闭前：若标题后缀和内容都为空，则删除本次占位条目（不留空记录）；否则保存
  const handleClose = useCallback(() => {
    const isEmpty = titleSuffix.trim() === '' && currentContent.trim() === ''
    if (isEmpty) {
      deleteLastDevNote(batteryId, currentTsRef.current)
    } else {
      handleSave()
    }
    onClose()
  }, [titleSuffix, currentContent, batteryId, deleteLastDevNote, handleSave, onClose])

  // ESC 关闭：仅当此弹窗内有聚焦元素时响应
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalRef.current?.contains(document.activeElement)) {
        handleClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleClose])

  // 从 store 读取历史条目（当前条目之前的所有条目）
  const allEntries = batteryDevNotes[batteryId] ?? []
  // 历史条目 = 不含最后一条（最后一条是本次新建的当前条目）
  const historyEntries = allEntries.length > 0 ? allEntries.slice(0, -1) : []

  return createPortal(
    <div
      className="dev-note-modal"
      ref={modalRef}
      style={{ left: pos.x, top: pos.y, width: MODAL_WIDTH, maxHeight: MODAL_MAX_HEIGHT }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* 可拖拽 header */}
      <div className="dev-note-modal-header" onMouseDown={handleHeaderMouseDown}>
        <span className="dev-note-modal-title">
          📝 {langMode === 'en' ? 'Dev Notes' : '开发记录'} — {batteryName}
        </span>
        <button
          className="dev-note-modal-close"
          onClick={handleClose}
          title={langMode === 'en' ? 'Close' : '关闭'}
        >
          ×
        </button>
      </div>

      {/* 滚动内容区 */}
      <div className="dev-note-modal-body" ref={scrollRef}>
        {/* 历史条目（只读） */}
        {historyEntries.map((entry) => (
          <div key={entry.ts} className="dev-note-entry dev-note-entry--readonly">
            <div className="dev-note-entry-title">{entry.title}</div>
            <div className="dev-note-entry-content">{entry.content || ' '}</div>
          </div>
        ))}

        {/* 当前条目（可编辑） */}
        <div className="dev-note-entry dev-note-entry--active">
          {/* 标题行：只读时间戳（灰色斜体）+ 可追加部分 */}
          <div className="dev-note-entry-title-row">
            <span className="dev-note-entry-ts">{timestampStr}</span>
            <input
              className="dev-note-entry-suffix-input"
              value={titleSuffix}
              onChange={e => setTitleSuffix(e.target.value)}
              onBlur={handleSave}
              placeholder={langMode === 'en' ? 'add title...' : '追加标题...'}
              spellCheck={false}
            />
          </div>
          {/* 内容输入区：自动撑高，超出后出滚动条 */}
          <textarea
            ref={contentTextareaRef}
            className="dev-note-entry-content-input"
            value={currentContent}
            onChange={handleContentChange}
            onBlur={handleSave}
            placeholder={langMode === 'en' ? 'Write your dev notes here...' : '在这里记录开发笔记...'}
            spellCheck={false}
            rows={1}
            style={{
              height: textareaHeight != null ? `${textareaHeight}px` : undefined,
              overflowY: textareaHeight != null && textareaHeight >= TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden',
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
