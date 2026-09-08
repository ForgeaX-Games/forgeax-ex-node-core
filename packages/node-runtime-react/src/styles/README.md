# `@forgeax/node-runtime-react/styles.css`

Optional legacy visual chrome shipped as a CSS sub-export. Mirrors
the `legacyTheme` token bundle (`../themes/index.ts`) as CSS custom
properties so consumers can override at the cascade layer rather
than via a TypeScript object.

## When to use which

The package ships two parallel ways to recreate the legacy
application's chrome. Pick the one that fits the consumer's
build:

| Mechanism | Surface | When to pick |
| --- | --- | --- |
| `legacyTheme` (TS bundle) | `import { legacyTheme } from '@forgeax/node-runtime-react/themes'` then `<NodeCanvas theme={legacyTheme} ... />` | Default. JS-driven inline styles. Type-checked. Composes with `resolveTheme(...)` deep merge. |
| `styles.css` (this file) | `import '@forgeax/node-runtime-react/styles.css'` once at the consumer entry point | When you want CSS-cascade overrides (design-system variables, dark-mode toggles, per-page reskins) without rebuilding the JS bundle. |

The two mechanisms are complementary and idempotent: the theme
prop drives JS-computed inline styles, the CSS file styles surfaces
that read variables directly. Importing both is supported.

## Override pattern

Redefine any custom property in a stylesheet that loads after
`styles.css`:

```css
/* consumer-overrides.css — loaded after the package import */
:root {
  --forgeax-node-border: #888;
  --forgeax-battery-color-math: #ff00ff;
  --forgeax-edge-running: #00d1ff;
}
```

Or scope per-subtree with the `.forgeax-canvas` wrapper class:

```html
<div class="forgeax-canvas dark-theme">
  <NodeCanvas ... />
</div>
```

```css
.dark-theme {
  --forgeax-bg: #0b0b0d;
  --forgeax-node-bg: #18181b;
  --forgeax-node-header-bg: #27272a;
  --forgeax-surface-fg: #fafafa;
}
```

## CSS variables

All variables are declared on `:root`. Group by subsystem:

### Canvas chrome

| Variable | Controls |
| --- | --- |
| `--forgeax-bg` | Canvas background |
| `--forgeax-font` | Default font-family for all surfaces |

### Generic node card (BatteryNode + others)

| Variable | Controls |
| --- | --- |
| `--forgeax-node-bg` | Card background |
| `--forgeax-node-border` | Card border (idle) |
| `--forgeax-node-border-selected` | Card border when selected |
| `--forgeax-node-border-radius` | Card corner radius |
| `--forgeax-node-header-bg` | Header strip background |
| `--forgeax-node-header-fg` | Header text colour |
| `--forgeax-node-body-fg` | Body text colour |
| `--forgeax-node-shadow` | Idle shadow stack |
| `--forgeax-node-shadow-hover` | Hover/selected shadow stack |

### RelayNode

| Variable | Controls |
| --- | --- |
| `--forgeax-relay-color` | Relay accent (the `--relay-color` legacy token) |
| `--forgeax-relay-handle-size` | Input/output handle diameter |

### AnnotationNode

| Variable | Controls |
| --- | --- |
| `--forgeax-annotation-bg` | Sticky-note background |
| `--forgeax-annotation-fg` | Sticky-note text colour |

### CanvasFrameNode

| Variable | Controls |
| --- | --- |
| `--forgeax-frame-bg` | Frame body fill |
| `--forgeax-frame-border` | Frame outline + title strip |
| `--forgeax-frame-title-fg` | Title text colour |

### Port handles

| Variable | Controls |
| --- | --- |
| `--forgeax-port-size` | Handle diameter |
| `--forgeax-port-border` | Handle outline |
| `--forgeax-port-bg` | Default handle fill |
| `--forgeax-port-any` / `-number` / `-string` / `-boolean` / `-object` / `-grid` / `-geometry` | Per-port-type fill colours |

### Edge palette (ProbeEdge)

| Variable | Controls |
| --- | --- |
| `--forgeax-edge-idle` | Edge stroke when idle |
| `--forgeax-edge-running` | Edge stroke while running (animated dashes) |
| `--forgeax-edge-completed` | Edge stroke after success |
| `--forgeax-edge-error` | Edge stroke after error |
| `--forgeax-edge-skipped` | Edge stroke when skipped |
| `--forgeax-edge-running-dash-ms` | Dash-march period |
| `--forgeax-edge-width` | Edge stroke width |

### Per-battery-type accent

| Variable | Controls |
| --- | --- |
| `--forgeax-battery-color-math` | Header accent for `[data-battery-kind="math"]` |
| `--forgeax-battery-color-io` | Header accent for `io` |
| `--forgeax-battery-color-json` | Header accent for `json` |
| `--forgeax-battery-color-ai` | Header accent for `ai` |
| `--forgeax-battery-color-asset` | Header accent for `asset` |
| `--forgeax-battery-color-group` | Header accent for `group` |
| `--forgeax-battery-color-special` | Header accent for `special` |
| `--forgeax-battery-color-default` | Fallback accent |

### Popover / Inspector / Palette surface

| Variable | Controls |
| --- | --- |
| `--forgeax-surface-bg` | Popover/inspector/palette background |
| `--forgeax-surface-border` | Outline |
| `--forgeax-surface-fg` | Body text colour |
| `--forgeax-surface-muted-fg` | Captions, status, min/max labels |
| `--forgeax-surface-selected-bg` | Selected row background |
| `--forgeax-surface-selected-fg` | Selected row text |
| `--forgeax-surface-shadow` | Popover shadow |
| `--forgeax-surface-radius` | Surface corner radius |

## Components re-themed

Selectors target both the `data-testid` attributes and the BEM-ish
`className` strings the components currently stamp:

- BatteryNode shell, header, title, status, ports, body, context menu
- RelayNode + handles
- ProbeEdge (idle / running / completed / error / skipped) with
  CSS-keyframe dash animation
- AnnotationNode (sticky note + textarea)
- CanvasFrameNode (title strip + body)
- CanvasSearchPopover (popover, count, list, items)
- BatteryPalette (panel + items)
- Inspector (panel + per-param row + label)
- NumberSliderPanel (range, input, min/max captions)
- TogglePanel (track, thumb, on-state)
- TextPanel / JsonPanel (textarea, read view, error)
- GridPanel (cells + placeholder)

## Limitations

- This file styles via class / `data-testid` attribute selectors.
  Selectors that target classes the components stamp today
  (`battery-node`, `battery-node__header`, `toggle-panel`,
  `annotation-node`, `number-slider-panel`, `text-panel`,
  `grid-panel`, `probe-edge-path`) light up immediately.
- Selectors for surfaces that currently render only inline styles
  (Inspector, BatteryPalette, CanvasSearchPopover, RelayNode,
  CanvasFrameNode) take effect once the Phase H2 component refactor
  stamps the matching `className` / `data-testid` hooks. The
  component refactor + this file together complete the look.
- The CSS file does not re-export anything from JS — it is a side-effect
  import. Tree-shaking does not strip it; consumers control inclusion
  via the import statement.
