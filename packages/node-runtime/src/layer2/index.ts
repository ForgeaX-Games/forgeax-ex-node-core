// Layer 2 — Stable Editing API.
//
// Single mutation entry (applyBatch) + queries + subscriptions. Every UI
// component, AI agent, CLI command, and test drives the runtime through
// this surface. Real implementations land in P3 / P5.

export * from './apply-batch.js'
export * from './import-graph.js'
export * from './project-registry.js'
export * from './queries.js'
export * from './runtime.js'
export * from './subscriptions.js'
export * from './execute-node.js'
export { createEventBus } from './event-bus.js'
export type { EventBus } from './event-bus.js'
