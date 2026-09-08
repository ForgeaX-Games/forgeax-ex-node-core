// Public entry: re-exports Layer 1 and Layer 2 surfaces.
// Plugins should import from '@forgeax/node-runtime' (this barrel) or, for
// finer-grained tree-shaking, from '@forgeax/node-runtime/layer1' and
// '@forgeax/node-runtime/layer2' subpath exports.

export * from './layer1/index.js'
export * from './layer2/index.js'

// Both layers export an `executeNode`: Layer 1's low-level single-node primitive
// and Layer 2's graph walker. The Layer 2 walker is the public API, so it wins at
// the root barrel; Layer 1's remains available via the '/layer1' subpath.
export { executeNode } from './layer2/index.js'

// Execution result/handle/request types — re-exported explicitly so consumers
// can `import type { ExecutionResult } from '@forgeax/node-runtime'`.
export type {
  ExecutionResult,
  ExecutionHandle,
  ExecuteNodeRequest,
} from './layer2/execute-node.js'
