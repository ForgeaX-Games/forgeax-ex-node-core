// Breadcrumb navigation: floats at the canvas top-left while in a group view,
// showing the nav hierarchy and allowing cross-level jumps. Ported from the
// legacy editor (components/canvas/GroupBreadcrumb.tsx).
// Behavior:
//  - Click the root / any middle crumb → jump to that level (depth = its index).
//  - Click the current (right-most) crumb = no-op.
//  - "← Back" = pop one level (the common case).
import { memo } from 'react'
import './GroupBreadcrumb.css'

export interface BreadcrumbItem {
  /** null = root level. */
  id: string | null
  name: string
}

interface GroupBreadcrumbProps {
  breadcrumbs: BreadcrumbItem[]
  onExit: () => void
  /** Jump to a given depth (0 = root, N = keep the first N levels). */
  onJumpToDepth?: (depth: number) => void
}

const GroupBreadcrumb = memo(function GroupBreadcrumb({
  breadcrumbs,
  onExit,
  onJumpToDepth,
}: GroupBreadcrumbProps) {
  if (breadcrumbs.length <= 1) return null

  return (
    <div className="group-breadcrumb">
      {breadcrumbs.map((crumb, idx) => {
        const isLast = idx === breadcrumbs.length - 1
        const canJump = !isLast && !!onJumpToDepth
        return (
          <span key={idx} className="group-breadcrumb__segment">
            {canJump ? (
              <button
                className="group-breadcrumb__name group-breadcrumb__name--clickable"
                onClick={() => onJumpToDepth!(idx)}
                title={`Jump to "${crumb.name}"`}
              >
                {crumb.name}
              </button>
            ) : (
              <span className={`group-breadcrumb__name${isLast ? ' group-breadcrumb__name--active' : ''}`}>
                {crumb.name}
              </span>
            )}
            {!isLast && <span className="group-breadcrumb__sep">›</span>}
          </span>
        )
      })}
      <button
        className="group-breadcrumb__exit-btn"
        onClick={onExit}
        title="Exit group view and return to parent"
      >
        ← Back
      </button>
    </div>
  )
})

export default GroupBreadcrumb
