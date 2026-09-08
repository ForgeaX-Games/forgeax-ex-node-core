import { beforeAll, describe, expect, it } from 'vitest'

import { createEditorBridge, type EditorMirrorSnapshot } from '../sync/editorBridge.js'

// jsdom does not implement BroadcastChannel; fall back to Node's global one so
// the cross-context round-trip is exercised deterministically in any env.
beforeAll(async () => {
  if (typeof (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel === 'undefined') {
    const { BroadcastChannel } = await import('node:worker_threads')
    ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      BroadcastChannel as unknown
  }
})

function waitFor<T>(arm: (resolve: (v: T) => void) => void, ms = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('bridge message timeout')), ms)
    arm((v) => {
      clearTimeout(t)
      resolve(v)
    })
  })
}

const SNAP: EditorMirrorSnapshot = {
  history: { entries: [{ id: 'e1', type: 'add_node', timestamp: 1, label: '加', labelEn: 'Add' }], cursor: 1 },
  status: {
    connectionStatus: 'connected',
    pipelineStatus: 'idle',
    selectedNodeName: null,
    selectedNodeBatteryId: null,
    nodeCount: 2,
    edgeCount: 1,
  },
}

describe('editorBridge', () => {
  it('delivers a published snapshot from host to a side subscriber', async () => {
    const host = createEditorBridge('bridge-test-state')
    const side = createEditorBridge('bridge-test-state')
    const received = await waitFor<EditorMirrorSnapshot>((res) => {
      side.onState(res)
      host.publishState(SNAP)
    })
    expect(received.status.nodeCount).toBe(2)
    expect(received.history.entries[0]?.label).toBe('加')
    host.close()
    side.close()
  })

  it('delivers a command from a side pane back to the host', async () => {
    const host = createEditorBridge('bridge-test-cmd')
    const side = createEditorBridge('bridge-test-cmd')
    const cmd = await waitFor<{ type: string }>((res) => {
      host.onCommand(res)
      side.sendCommand({ type: 'clear-history' })
    })
    expect(cmd.type).toBe('clear-history')
    host.close()
    side.close()
  })

  it('isolates channels keyed differently', async () => {
    const host = createEditorBridge('bridge-test-iso-a')
    const side = createEditorBridge('bridge-test-iso-b')
    let leaked = false
    side.onState(() => {
      leaked = true
    })
    host.publishState(SNAP)
    await new Promise((r) => setTimeout(r, 50))
    expect(leaked).toBe(false)
    host.close()
    side.close()
  })
})
