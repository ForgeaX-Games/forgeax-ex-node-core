// CustomSelect — a portal-mounted dropdown. Ported from the legacy editor
// (components/common/CustomSelect.tsx).
//
// Two key design decisions preserved verbatim:
//
// 1. createPortal -> document.body:
//    ReactFlow node containers carry `transform: translate/scale`, which breaks
//    position:fixed viewport anchoring (a fixed element positions relative to the
//    transformed ancestor, not the viewport, so the panel renders off-screen).
//    Mounting the dropdown straight onto document.body sidesteps this entirely.
//
// 2. onMouseDown + stopPropagation (not onClick):
//    The document mousedown close-handler and an onClick open-handler race: the
//    document mousedown fires before the click -> close() -> then click ->
//    openDropdown(), so the panel never closes (closes then reopens). Using
//    onMouseDown and stopping propagation keeps the close listener from reacting
//    to the trigger button itself.
import { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import './CustomSelect.css'

export interface CustomSelectOption {
  value: string | number
  label: string
}

interface CustomSelectProps {
  value: string | number
  onChange: (value: string | number) => void
  options: CustomSelectOption[]
  /** Extra class for scenario variants (e.g. ai-select, ns-select). */
  className?: string
  disabled?: boolean
  /** Set true when used inside a ReactFlow node to prevent canvas-drag conflicts. */
  nodrag?: boolean
}

function CustomSelect({ value, onChange, options, className = '', disabled = false, nodrag = false }: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState<{ top: number; left: number; minWidth: number }>({
    top: 0, left: 0, minWidth: 0,
  })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const selected = options.find(o => String(o.value) === String(value))

  const calcPos = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setDropPos({ top: rect.bottom + 3, left: rect.left, minWidth: rect.width })
    }
  }, [])

  // Handle the trigger via onMouseDown (not onClick), stopping propagation so it
  // does not bubble to the document close-listener.
  const handleTriggerMouseDown = (e: React.MouseEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    if (!open) calcPos()
    setOpen(o => !o)
  }

  // Keyboard support.
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!open) calcPos(); setOpen(o => !o); return }
    const idx = options.findIndex(o => String(o.value) === String(value))
    if (e.key === 'ArrowDown') { e.preventDefault(); if (idx < options.length - 1) onChange(options[idx + 1].value) }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (idx > 0) onChange(options[idx - 1].value) }
  }

  // Close when clicking outside the trigger/dropdown; close on scroll.
  useEffect(() => {
    if (!open) return
    const closeOnOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return   // trigger click handled by handleTriggerMouseDown
      if (dropdownRef.current?.contains(target)) return  // click inside dropdown: do not close
      setOpen(false)
    }
    const closeOnScroll = () => setOpen(false)
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [open])

  const wrapperClass = [
    'custom-select',
    className,
    disabled ? 'custom-select--disabled' : '',
    nodrag ? 'nodrag' : '',
  ].filter(Boolean).join(' ')

  // The dropdown panel is portal-mounted to document.body, fully escaping
  // ReactFlow's transform context.
  const dropdown = open ? (
    <div
      ref={dropdownRef}
      className="custom-select-dropdown"
      style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.minWidth }}
      role="listbox"
    >
      {options.map(opt => (
        <div
          key={opt.value}
          className={`custom-select-option${String(opt.value) === String(value) ? ' custom-select-option--active' : ''}`}
          role="option"
          aria-selected={String(opt.value) === String(value)}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onChange(opt.value)
            setOpen(false)
          }}
        >
          {opt.label}
        </div>
      ))}
    </div>
  ) : null

  return (
    <div className={wrapperClass}>
      <button
        ref={triggerRef}
        className={`custom-select-trigger${nodrag ? ' nodrag' : ''}`}
        onMouseDown={handleTriggerMouseDown}
        onKeyDown={handleKey}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="custom-select-value">{selected?.label ?? ''}</span>
        <svg
          className={`custom-select-chevron${open ? ' custom-select-chevron--open' : ''}`}
          viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {typeof document !== 'undefined' && ReactDOM.createPortal(dropdown, document.body)}
    </div>
  )
}

export default CustomSelect
