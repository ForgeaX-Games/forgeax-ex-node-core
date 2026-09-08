import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'

import {
  resolveConnectionPortType,
} from '../components/canvas/useCanvasConnect.js'
import {
  RELAY_BATTERY_ID,
  RELAY_INPUT_PORT,
  RELAY_OUTPUT_PORT,
} from '../components/canvas/RelayNode.js'

describe('relay connection compatibility helpers', () => {
  it('keeps relay input permissive and relay output typed by its followed port', () => {
    const relayNode = {
      id: 'r1',
      type: 'relay',
      data: { portType: 'number', battery: { id: RELAY_BATTERY_ID } },
    } as Node

    expect(resolveConnectionPortType(relayNode, RELAY_INPUT_PORT, 'target')).toBe('any')
    expect(resolveConnectionPortType(relayNode, RELAY_OUTPUT_PORT, 'source')).toBe('number')
    expect(resolveConnectionPortType(relayNode, RELAY_INPUT_PORT, 'source')).toBeUndefined()
  })

  it('resolves ordinary battery ports unchanged', () => {
    const batteryNode = {
      id: 'n1',
      type: 'battery',
      data: {
        battery: {
          id: 'demo.echo',
          inputs: [{ name: 'in', type: 'string' }],
          outputs: [{ name: 'out', type: 'string' }],
        },
      },
    } as Node

    expect(resolveConnectionPortType(batteryNode, 'out', 'source')).toBe('string')
    expect(resolveConnectionPortType(batteryNode, 'in', 'target')).toBe('string')
  })
})
