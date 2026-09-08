// Op registry — register / query / list ops at runtime.
//
// Plugins call register(spec) at boot to add their domain ops; the dispatcher
// + executor resolve ops by id at execution time. Registry instances are
// process-local; cross-plugin op sharing happens at the manifest level, not
// through a shared registry.

import type { OpSpec } from './types/op-spec.js'

/**
 * In-memory op registry. Plugins call `registerOp` at boot to add their
 * domain ops; the executor resolves an op by id at execution time.
 */
export class OpRegistry {
  private readonly ops = new Map<string, OpSpec>()

  register(spec: OpSpec): void {
    if (this.ops.has(spec.id)) {
      throw new Error(`Op id already registered: ${spec.id}`)
    }
    this.ops.set(spec.id, spec)
  }

  get(id: string): OpSpec | undefined {
    return this.ops.get(id)
  }

  list(): readonly OpSpec[] {
    return [...this.ops.values()]
  }

  has(id: string): boolean {
    return this.ops.has(id)
  }

  /** Remove an op. Used by the battery loader during update / removal events. */
  unregister(id: string): boolean {
    return this.ops.delete(id)
  }

  /** Replace an op atomically (delete + register). Used by hot reload. */
  replace(spec: OpSpec): void {
    this.ops.delete(spec.id)
    this.ops.set(spec.id, spec)
  }
}

/** Default singleton registry (most callers use this). */
export const defaultRegistry = new OpRegistry()
