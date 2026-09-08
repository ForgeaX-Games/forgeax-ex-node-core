// Standalone, reusable versions of the gear-menu preference toggles, so a host
// app that hides the settings button (showSettingsButton={false}) can re-mount
// the same controls elsewhere (e.g. a side pane) without re-implementing them.
//
// Each reads/writes the kernel uiStore exactly as the in-gear control did, so
// behaviour + persistence are identical; cross-iframe propagation is handled by
// the uiStore `storage`-event sync. Markup is self-contained (own CSS) so the
// toggles render correctly outside the toolbar's stylesheet.
import { useUIStore } from '../../stores/index.js'
import './SettingsToggles.css'

function Languages({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  )
}

/** Node-label language toggle (zh labels ↔ en identifiers). */
export function LanguageToggle(): JSX.Element {
  const langMode = useUIStore((s) => s.langMode)
  const toggleLangMode = useUIStore((s) => s.toggleLangMode)
  const en = langMode === 'en'
  return (
    <label className="kernel-toggle-row">
      <input type="checkbox" checked={en} onChange={() => toggleLangMode()} />
      <Languages size={13} />
      <span>{en ? 'English labels' : '英文显示'}</span>
    </label>
  )
}

/** Show-dev-note-count badge toggle (battery cards). */
export function DevNoteCountToggle(): JSX.Element {
  const showDevNoteCount = useUIStore((s) => s.showDevNoteCount)
  const toggleShowDevNoteCount = useUIStore((s) => s.toggleShowDevNoteCount)
  const langMode = useUIStore((s) => s.langMode)
  const en = langMode === 'en'
  return (
    <label className="kernel-toggle-row">
      <input type="checkbox" checked={showDevNoteCount} onChange={() => toggleShowDevNoteCount()} />
      <span>{en ? 'Show dev note count badge' : '显示开发记录数量角标'}</span>
    </label>
  )
}
