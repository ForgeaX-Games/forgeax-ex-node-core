// Battery (op) loader public surface.
//
// Plugins call createBatteryLoader(registry, config) at boot, then
// loader.scan() (or loader.startWatching() for hot-reload). Subscribe to
// loader events to mirror the registry diff into plugin-side UI metadata.

export { createBatteryLoader } from './battery-loader.js'
export { metaToOpSpec } from './meta-parser.js'
export type {
  BatteryLoader,
  BatteryLoaderConfig,
  BatteryMeta,
  BatteryMetaDynamicConfig,
  BatteryMetaParam,
  BatteryMetaPort,
  LoaderEvent,
  LoaderUnsubscribe,
  ScanError,
  ScanLayout,
  ScanResult,
} from './types.js'
