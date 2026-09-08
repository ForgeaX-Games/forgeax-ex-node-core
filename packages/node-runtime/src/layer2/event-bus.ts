// In-memory implementation of the SubscriptionAPI declared in subscriptions.ts.
//
// One bus per Runtime. Consumers subscribe via runtime.subscriptions (the
// subscribe-only SubscriptionAPI view); only kernel Layer 2 functions emit,
// resolving the emit-capable bus from the internal WeakMap registry.

import type {
  RuntimeChannel,
  RuntimeEvent,
  SubscriptionAPI,
} from './subscriptions.js'

export interface EventBus extends SubscriptionAPI {
  emit(event: RuntimeEvent): void
}

interface Subscription {
  pipelineId: string
  channels: ReadonlySet<RuntimeChannel>
  handler: (event: RuntimeEvent) => void
}

function channelOf(kind: RuntimeEvent['kind']): RuntimeChannel {
  if (kind.startsWith('graph:')) return 'graph'
  if (kind.startsWith('exec:')) return 'execution'
  // Workspace lifecycle (project:activated) rides the 'graph' channel, matching
  // the client transport's demux (any non-exec/non-asset kind → 'graph').
  if (kind.startsWith('project:')) return 'graph'
  return 'asset'
}

export function createEventBus(): EventBus {
  const subscriptions = new Set<Subscription>()

  return {
    subscribe(pipelineId, channels, handler) {
      const entry: Subscription = { pipelineId, channels: new Set(channels), handler }
      subscriptions.add(entry)
      return () => {
        subscriptions.delete(entry)
      }
    },
    emit(event) {
      const channel = channelOf(event.kind)
      // Asset events carry no pipelineId; match them by channel only.
      const pipelineId = 'pipelineId' in event ? event.pipelineId : undefined
      for (const sub of subscriptions) {
        if (pipelineId !== undefined && sub.pipelineId !== pipelineId) continue
        if (!sub.channels.has(channel)) continue
        try {
          sub.handler(event)
        } catch {
          // One bad subscriber must not break a run or other subscribers.
        }
      }
    },
  }
}

// Internal registry: maps a Runtime instance to its emit-capable bus.
const busRegistry = new WeakMap<object, EventBus>()

export function attachBus(key: object, bus: EventBus): void {
  busRegistry.set(key, bus)
}

export function busFor(key: object): EventBus {
  const bus = busRegistry.get(key)
  if (!bus) throw new Error('No event bus attached to this Runtime')
  return bus
}
