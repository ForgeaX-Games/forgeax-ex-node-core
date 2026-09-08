import { describe, it, expect } from 'vitest'
import { DataTree } from '../index.js'
import { treeMerge } from '../../../batteries-common/batteries/common/datatree/tree_merge/index.js'

// A ScenePortValue is shaped { tree: SceneNodeSnapshot, focus: string }.
// Feeding one into tree_merge is a scene-assembly misuse that should produce an
// actionable error pointing at add_child rather than a silently broken DataTree.
function scenePortItem() {
  return { tree: { id: 'root', children: [] }, focus: 'root' }
}

describe('tree_merge battery', () => {
  it('item-access concat merges plain DataTrees by path', () => {
    const a = DataTree.fromEntries([{ path: [0], items: ['A'] }])
    const b = DataTree.fromEntries([{ path: [0], items: ['B'] }])
    const out = treeMerge({ portCount: 2, inferredAccess: 'item', item_0: a, item_1: b })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([{ path: [0], items: ['A', 'B'] }])
  })

  it('default/structure pack prefixes each slot with its index', () => {
    const a = DataTree.fromEntries([{ path: [0], items: ['A'] }])
    const b = DataTree.fromEntries([{ path: [0], items: ['B'] }])
    const out = treeMerge({ portCount: 2, item_0: a, item_1: b })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([
      { path: [0, 0], items: ['A'] },
      { path: [1, 0], items: ['B'] },
    ])
  })

  it('passes ScenePortValue items through in item-access mode (legitimate list collection)', () => {
    // item 档把各 slot 的 scene 当独立 item 按 path concat —— 即「收集成 list 再喂给
    // add_child.nodes」的合法管线，不应报错。
    const sceneItem = scenePortItem()
    const scene = DataTree.fromEntries([{ path: [0], items: [sceneItem] }])
    const plain = DataTree.fromEntries([{ path: [0], items: ['A'] }])
    const out = treeMerge({ portCount: 2, inferredAccess: 'item', item_0: plain, item_1: scene })
    expect(out.error).toBeUndefined()
    expect((out.tree as DataTree<unknown>).toJSON()).toEqual([{ path: [0], items: ['A', sceneItem] }])
  })

  it('rejects ScenePortValue items in structure-pack mode with an add_child hint', () => {
    const scene = DataTree.fromEntries([{ path: [0], items: [scenePortItem()] }])
    const out = treeMerge({ portCount: 1, item_0: scene })
    expect(out.tree).toBeUndefined()
    expect(out.error).toMatch(/add_child/)
  })

  it('still errors on non-DataTree slot inputs', () => {
    const out = treeMerge({ portCount: 1, item_0: { not: 'a tree' } })
    expect(out.error).toMatch(/must be a DataTree/)
  })
})
