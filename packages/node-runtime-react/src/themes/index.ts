// Theme bundles. Consumers either pass a partial NodeCanvasTheme
// override (deep-merged with defaultTheme by the shell) or pass one
// of the named bundles below verbatim.
//
// `defaultTheme` matches the v0.2.0 minimal look (inline literal
// hex values that components currently fall back to when theme
// fields are absent — kept centralised so refactors have one source
// of truth).
//
// `legacyTheme` recreates the original application's visual chrome
// (per-battery-type colour map, hover multi-shadow stack, port-options
// dropdown styling, animated handles, etc.) for one-line legacy
// parity. Consumers wire it as:
//
//   import { legacyTheme } from '@forgeax/node-runtime-react/themes'
//   <NodeCanvas theme={legacyTheme} ... />
//
// The styles.css sub-export ships the same values keyed to CSS
// custom properties for consumers that want to override in their
// own stylesheet.

/**
 * Theme tokens consumed by the theme bundles below. Originally declared in the
 * (now-removed) v0.2.0 `NodeCanvas` tree; inlined here so the `./themes`
 * sub-export is fully self-contained after the deprecated `.` surface was
 * deleted. The faithful editor (`./editor`) carries its own styling and does
 * not consume this type.
 */
export interface NodeCanvasTheme {
  // Canvas chrome -----------------------------------------------------------
  background?: string

  // Generic node card (BatteryNode / RelayNode / AnnotationNode / etc.) ----
  node?: {
    background?: string
    border?: string
    borderSelected?: string
    borderRadius?: number
    headerBackground?: string
    headerForeground?: string
    bodyForeground?: string
    shadow?: string
    shadowHover?: string
  }

  // RelayNode specific accent ---------------------------------------------
  relay?: {
    color?: string
    handleSize?: number
  }

  // AnnotationNode specific ------------------------------------------------
  annotation?: {
    defaultBackground?: string
    foreground?: string
  }

  // CanvasFrameNode specific ----------------------------------------------
  frame?: {
    background?: string
    border?: string
    titleForeground?: string
  }

  // Handles + port colours ------------------------------------------------
  // Per-type handle colours are NOT themed here: the editor derives them from
  // the canonical port-type registry (see editor/utils/portTypes — getPortTypeColor
  // + domainPortTypes), the single source of truth for type → colour.
  port?: {
    size?: number
    borderColor?: string
    background?: string
  }

  // Edge palette by run-state ---------------------------------------------
  edge?: {
    idle?: string
    running?: string
    completed?: string
    error?: string
    skipped?: string
    /** Animated-dash period for the running state. */
    runningDashMs?: number
    width?: number
  }

  // Per-battery-type accent ------------------------------------------------
  battery?: {
    /** Accent colour map keyed by an arbitrary battery-type discriminator
     *  (consumer-defined — e.g. opId category prefix). */
    accentByKey?: Record<string, string>
    defaultAccent?: string
  }

  // Popover / inspector / palette chrome ----------------------------------
  surface?: {
    background?: string
    border?: string
    foreground?: string
    mutedForeground?: string
    selectedBackground?: string
    selectedForeground?: string
    fontFamily?: string
  }
}

export const defaultTheme: NodeCanvasTheme = {
  background: '#fafafa',
  node: {
    background: '#ffffff',
    border: '#cfcfcf',
    borderSelected: '#2563eb',
    borderRadius: 6,
    headerBackground: '#f3f4f6',
    headerForeground: '#111827',
    bodyForeground: '#374151',
    shadow: '0 1px 2px rgba(0,0,0,0.06)',
    shadowHover: '0 4px 12px rgba(0,0,0,0.10)',
  },
  relay: {
    color: '#4f8cff',
    handleSize: 8,
  },
  annotation: {
    defaultBackground: '#fff8b8',
    foreground: '#1f2937',
  },
  frame: {
    background: '#e0f2fe',
    border: '#0284c7',
    titleForeground: '#ffffff',
  },
  port: {
    size: 10,
    borderColor: '#374151',
    background: '#94a3b8',
  },
  edge: {
    idle: '#94a3b8',
    running: '#3b82f6',
    completed: '#22c55e',
    error: '#ef4444',
    skipped: '#f97316',
    runningDashMs: 1000,
    width: 1.5,
  },
  battery: {
    accentByKey: {},
    defaultAccent: '#2563eb',
  },
  surface: {
    background: '#ffffff',
    border: '#d1d5db',
    foreground: '#111827',
    mutedForeground: '#6b7280',
    selectedBackground: '#2563eb',
    selectedForeground: '#ffffff',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
}

/**
 * Full-fidelity legacy chrome. Restores the original application's
 * per-battery colour map, hover shadow stack, and animated handles.
 * Consumers pass this verbatim:
 *
 *   import { legacyTheme } from '@forgeax/node-runtime-react/themes'
 *   <NodeCanvas theme={legacyTheme} apiClient={client} pipelineId="..." />
 */
export const legacyTheme: NodeCanvasTheme = {
  ...defaultTheme,
  background: '#f7f7f8',
  node: {
    ...defaultTheme.node,
    background: '#ffffff',
    border: '#d4d4d8',
    borderSelected: '#3b82f6',
    headerBackground: '#fafafa',
    headerForeground: '#18181b',
    shadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.06)',
    shadowHover: '0 2px 4px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.12)',
  },
  relay: {
    color: '#6366f1',
    handleSize: 8,
  },
  annotation: {
    defaultBackground: '#fef3c7',
    foreground: '#451a03',
  },
  frame: {
    background: '#dbeafe',
    border: '#1d4ed8',
    titleForeground: '#ffffff',
  },
  port: {
    ...defaultTheme.port,
  },
  edge: {
    idle: '#a1a1aa',
    running: '#2563eb',
    completed: '#16a34a',
    error: '#dc2626',
    skipped: '#ea580c',
    runningDashMs: 800,
    width: 1.75,
  },
  battery: {
    accentByKey: {
      // Common legacy battery-type keys. Consumers that use a different
      // discriminator (opId, category, opSpec.tags[0]) map their keys
      // into this dict.
      math: '#3b82f6',
      io: '#16a34a',
      json: '#d97706',
      ai: '#a855f7',
      asset: '#0891b2',
      group: '#6366f1',
      special: '#dc2626',
    },
    defaultAccent: '#3b82f6',
  },
  surface: {
    ...defaultTheme.surface,
    background: '#ffffff',
    border: '#e4e4e7',
    foreground: '#18181b',
    mutedForeground: '#71717a',
    selectedBackground: '#3b82f6',
    selectedForeground: '#ffffff',
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
  },
}

/**
 * Deep-merge `override` into `defaultTheme`. Used by NodeCanvas before
 * forwarding the resolved theme to components. Consumer overrides are
 * shallow-per-section but deep across nested fields the consumer
 * explicitly sets.
 */
export function resolveTheme(override?: NodeCanvasTheme): NodeCanvasTheme {
  if (!override) return defaultTheme
  return {
    ...defaultTheme,
    ...override,
    node: { ...defaultTheme.node, ...override.node },
    relay: { ...defaultTheme.relay, ...override.relay },
    annotation: { ...defaultTheme.annotation, ...override.annotation },
    frame: { ...defaultTheme.frame, ...override.frame },
    port: {
      ...defaultTheme.port,
      ...override.port,
    },
    edge: { ...defaultTheme.edge, ...override.edge },
    battery: {
      ...defaultTheme.battery,
      ...override.battery,
      accentByKey: { ...defaultTheme.battery?.accentByKey, ...override.battery?.accentByKey },
    },
    surface: { ...defaultTheme.surface, ...override.surface },
  }
}
