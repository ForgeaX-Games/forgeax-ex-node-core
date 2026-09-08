// GroupNode smoke test — render the ported group node over a store seeded with a
// NodeGroup and assert the real legacy classes mount: the .group-node root, the
// four header action buttons, and the exposed input/output port labels. Verifies
// the group sub-graph node type registers in the canvas nodeTypes map too.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from 'reactflow'

import { usePipelineStore } from '../stores/pipelineStore.js'
// Import canvasConstants before GroupNode — the real-world order (Canvas pulls in
// canvasConstants first). The canvas node modules form a legacy import cycle
// (canvasConstants → GroupNode → groupViewUtils → canvasConstants); entering via
// canvasConstants resolves GroupNode's default before the nodeTypes literal reads it.
import { nodeTypes } from '../components/canvas/canvasConstants.js'
import GroupNode, { buildGroupNodeData } from '../components/canvas/GroupNode.js'
import type { NodeGroup, Pipeline } from '../types.js'

const group: NodeGroup = {
  id: 'group_1',
  name: '地形组',
  nameEn: 'Terrain Group',
  position: { x: 0, y: 0 },
  nodes: [{ id: 'inner1', batteryId: 'demo.echo', name: 'Echo', position: { x: 0, y: 0 }, params: {} }],
  exposedInputs: [
    { portName: 'in_a', portType: 'number', sourceNodeId: 'inner1', sourcePortName: 'a', order: 0 },
  ],
  exposedOutputs: [
    { portName: 'out_x', portType: 'grid', sourceNodeId: 'inner1', sourcePortName: 'x', order: 0 },
  ],
}

function pipelineWithGroup(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p', name: 'p', description: '',
    nodes: [{ id: 'group_1', batteryId: '__group__', name: 'Terrain Group', position: { x: 0, y: 0 }, params: { groupId: 'group_1' } }],
    edges: [],
    groups: [group],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle', createdAt: now, updatedAt: now,
  }
}

beforeEach(() => {
  usePipelineStore.setState({
    batteries: [], categories: [], currentPipeline: pipelineWithGroup(),
    selectedNode: null, selectedNodeIds: [], logs: [], nodeOutputs: {},
    dynamicOutputPorts: {}, groupViewStack: [],
  })
})

afterEach(() => {
  usePipelineStore.setState({ currentPipeline: null })
})

describe('GroupNode smoke', () => {
  it("registers 'group' in the canvas nodeTypes map", () => {
    expect(nodeTypes.group).toBe(GroupNode)
  })

  it('mounts the group node with real classes, action buttons + port labels', () => {
    const data = buildGroupNodeData(group, () => {}, () => {})
    const { container } = render(
      <ReactFlowProvider>
        <GroupNode id="group_1" type="group" data={data} selected={false} dragging={false}
          xPos={0} yPos={0} zIndex={0} isConnectable dragHandle={undefined} />
      </ReactFlowProvider>,
    )

    expect(container.querySelector('.group-node')).not.toBeNull()
    // Four header actions: save / restore / enter / ungroup.
    expect(container.querySelector('.group-node__action-btn--save')).not.toBeNull()
    expect(container.querySelector('.group-node__action-btn--restore')).not.toBeNull()
    expect(container.querySelector('.group-node__action-btn--enter')).not.toBeNull()
    expect(container.querySelector('.group-node__action-btn--ungroup')).not.toBeNull()
    // Exposed ports render their display label (defaults to the source port name).
    const labels = Array.from(container.querySelectorAll('.group-node__port-label')).map((e) => e.textContent)
    expect(labels).toContain('a')
    expect(labels).toContain('x')
  })
})
