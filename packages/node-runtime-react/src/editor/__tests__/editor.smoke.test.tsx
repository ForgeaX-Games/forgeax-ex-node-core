// Composed <Editor> smoke test — mounts the faithful editor (Toolbar ·
// BatteryBar · Canvas) against a seeded MockApiClient and asserts: the real
// legacy layout classes are present, the title / actions slots render, batteries
// + pipeline load through the transport, and an out-of-band applyBatch (a
// non-UI actor) syncs onto the canvas — the North-Star "watch the AI work" path.
//
// jsdom gaps used by ReactFlow (ResizeObserver / DOMMatrix) are polyfilled in
// src/test/setup.ts.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'

import type { OpSpec, GraphNode, GraphEdge } from '@forgeax/node-runtime'
import { createMockApiClient, type MockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useUIStore } from '../stores/uiStore.js'
import { Editor } from '../Editor.js'
import BatteryNode from '../components/canvas/BatteryNode.js'

const OPS: OpSpec[] = [
  { id: 'scene.terrain', name: '地形生成', inputs: [{ name: 'seed', type: 'number' }], outputs: [{ name: 'grid', type: 'grid' }], params: [], execute: () => null },
  { id: 'scene.voxelize', name: '体素化', inputs: [{ name: 'grid', type: 'grid' }], outputs: [{ name: 'scene', type: 'scene' }], params: [], execute: () => null },
]
function commonOp(id: string, name: string, smallTag: string): OpSpec {
  return {
    id,
    name,
    category: `common/${smallTag}`,
    inputs: [],
    outputs: [],
    params: [],
    execute: () => null,
  } as OpSpec
}
const NODES: GraphNode[] = [
  { id: 'n1', opId: 'scene.terrain', position: { x: 40, y: 40 }, params: {} },
  { id: 'n2', opId: 'scene.voxelize', position: { x: 320, y: 40 }, params: {} },
]
const EDGES: GraphEdge[] = [
  { id: 'e1', source: { nodeId: 'n1', port: 'grid' }, target: { nodeId: 'n2', port: 'grid' } },
]

let client: MockApiClient

beforeEach(() => {
  client = createMockApiClient({ ops: OPS, nodes: NODES, edges: EDGES })
})

afterEach(() => {
  // Editor's unmount effect disposes its transport; ensure the global slot is clear.
  configureEditorTransport(null)
  usePipelineStore.setState({ batteries: [], currentPipeline: null, nodeOutputs: {} })
  useUIStore.setState({ batteryFilterMode: 'develop' })
})

describe('composed <Editor> smoke', () => {
  it('mounts the faithful legacy layout with title + actions slots', async () => {
    const { container } = render(
      <Editor apiClient={client} title="Scene Generator" toolbarActions={<button type="button">AI</button>} />,
    )

    // Faithful layout chain from EditorLayout.css.
    for (const cls of ['.app', '.editor-pane', '.main-layout', '.main-content', '.canvas-container']) {
      expect(container.querySelector(cls), `missing ${cls}`).not.toBeNull()
    }
    // The three real regions mounted.
    expect(container.querySelector('.toolbar')).not.toBeNull()
    expect(container.querySelector('.battery-bar')).not.toBeNull()
    expect(container.querySelector('.react-flow')).not.toBeNull()
    // Injected title + actions.
    expect(container.querySelector('.logo-text')?.textContent).toBe('Scene Generator')
    expect(container.querySelector('.toolbar-right')?.textContent).toContain('AI')
  })

  it('loads batteries + pipeline through the transport', async () => {
    render(<Editor apiClient={client} />)
    await waitFor(() => {
      expect(usePipelineStore.getState().batteries.length).toBe(OPS.length)
      expect(usePipelineStore.getState().currentPipeline?.nodes.length).toBe(NODES.length)
    })
  })

  it('renders common battery groups in curated order from backend categories', async () => {
    const commonClient = createMockApiClient({
      ops: [
        commonOp('common.datatree', 'DataTree', 'datatree'),
        commonOp('common.input', 'Input', 'input'),
        commonOp('common.list', 'List', 'list'),
        commonOp('common.number', 'Number', 'number'),
        commonOp('common.preview', 'Preview', 'preview'),
      ],
    })
    const { container } = render(<Editor apiClient={commonClient} />)

    await waitFor(() => {
      expect([...container.querySelectorAll('.bb-small-text')].map(el => el.textContent)).toEqual([
        'Input',
        'List',
        'Datatree',
        'Number',
        'Annotation',
      ])
    })
  })

  it('boots transport before child effects read template categories', async () => {
    useUIStore.setState({ batteryFilterMode: 'templates' })

    render(<Editor apiClient={client} />)

    await waitFor(() => {
      expect(usePipelineStore.getState().currentPipeline?.nodes.length).toBe(NODES.length)
    })
  })

  it('hides the Run/Stop control and mounts a status-bar slot when asked', async () => {
    const { container } = render(
      <Editor
        apiClient={client}
        showRunControl={false}
        statusBar={<div className="app-statusbar">ready</div>}
      />,
    )
    expect(container.querySelector('.toolbar-btn-run')).toBeNull()
    expect(container.querySelector('.toolbar-btn-stop')).toBeNull()
    expect(container.querySelector('.app-statusbar')?.textContent).toBe('ready')
  })

  it('mounts a consumer-supplied domain node type without mutating the global map', async () => {
    const Domain = (): null => null
    const { nodeTypes } = await import('../components/canvas/canvasConstants.js')
    delete nodeTypes.scene_sink

    render(<Editor apiClient={client} domainNodeTypes={{ scene_sink: Domain }} />)
    await waitFor(() => {
      expect(usePipelineStore.getState().currentPipeline?.nodes.length).toBe(NODES.length)
    })

    // Domain types are merged per-render via createCanvasNodeTypes, never written
    // back into the shared module-global `nodeTypes` map (no global side effect).
    expect(nodeTypes.scene_sink).toBeUndefined()
  })

  it('renders domain port colors from props without global registration', async () => {
    const { container } = render(
      <Editor
        apiClient={client}
        domainPortTypes={[{ type: 'scene', desc: '场景', descEn: 'Scene', color: '#fb923c' }]}
      />,
    )

    // ReactFlow paints node handles asynchronously after the store node appears,
    // so wait for the handle element itself rather than just the store node.
    const sceneHandle = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[data-nodeid="n2"][data-handleid="scene"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(sceneHandle.style.background).toBe('rgb(251, 146, 60)')
  })

  it('injects domainPortTypes into domain node renderers (scene_sink → orange input handle)', async () => {
    // Regression for the Scene Output grey-input-handle bug: a domain node type
    // (scene_sink, registered to the kernel BatteryNode) routed through the bare
    // `...domainNodeTypes` spread and never received `domainPortTypes`, so its
    // scene-typed input handle fell back to the neutral grey (#6b7280) instead of
    // the scene orange (#fb923c). The fix wraps each domain renderer with
    // injectDomainPortTypes, exactly like the built-in colour-bearing renderers.
    const sinkOps = [
      {
        id: 'scene.output',
        name: 'Scene Output',
        inputs: [{ name: 'scene', type: 'scene' }],
        outputs: [{ name: 'layers', type: 'voxel_layers' }],
        params: [],
        nodeType: 'scene_sink',
        hideOutputs: true,
        execute: () => null,
      },
    ] as unknown as OpSpec[]
    const sinkNodes: GraphNode[] = [
      { id: 'sink1', opId: 'scene.output', position: { x: 40, y: 40 }, params: {} },
    ]
    const sinkClient = createMockApiClient({ ops: sinkOps, nodes: sinkNodes, edges: [] })

    const { container } = render(
      <Editor
        apiClient={sinkClient}
        domainNodeTypes={{ scene_sink: BatteryNode }}
        domainPortTypes={[{ type: 'scene', desc: '场景', descEn: 'Scene', color: '#fb923c' }]}
      />,
    )

    // ReactFlow paints node handles asynchronously after the store node appears,
    // so wait for the handle element itself rather than just the store node.
    const sceneHandle = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[data-nodeid="sink1"][data-handleid="scene"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    // Not the grey fallback (#6b7280 → rgb(107, 114, 128)) ...
    expect(sceneHandle.style.background).not.toBe('rgb(107, 114, 128)')
    // ... but the scene domain orange (#fb923c → rgb(251, 146, 60)).
    expect(sceneHandle.style.background).toBe('rgb(251, 146, 60)')
  })

  it('builds ReactFlow nodeTypes with consumer domain types before effects run', async () => {
    const Domain = (): null => null
    const { createCanvasNodeTypes, nodeTypes } = await import('../components/canvas/canvasConstants.js')
    delete nodeTypes.scene_sink

    const merged = createCanvasNodeTypes({ scene_sink: Domain })

    expect(merged.scene_sink).toBe(Domain)
    expect(nodeTypes.scene_sink).toBeUndefined()
    expect(merged.battery).toBe(nodeTypes.battery)
  })

  it('syncs an out-of-band AI op onto the canvas (live sync)', async () => {
    render(<Editor apiClient={client} />)
    await waitFor(() => expect(usePipelineStore.getState().currentPipeline?.nodes.length).toBe(NODES.length))

    await client.applyBatch(
      [{ type: 'createNode', nodeId: 'ai-1', opId: 'scene.voxelize', position: { x: 600, y: 200 }, params: {} }],
      { actor: 'ai-agent' },
    )

    await waitFor(() =>
      expect(usePipelineStore.getState().currentPipeline?.nodes.some(n => n.id === 'ai-1')).toBe(true),
    )
  })
})
