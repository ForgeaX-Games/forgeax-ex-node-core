/**
 * tree_merge：自适应合并。
 *
 * 行为档位由 inferredAccess（slot[0] 首次连接时由前端写入 node.params）决定：
 *   - 'item'              → item-级 concat：path 取并集，每个 path 内按 slot 顺序串联 items
 *                           （多 branch 结构按位保留；i-th slot 不前置 [i]）
 *   - 其它（list/tree/缺省）→ 结构 pack：第 i 个 slot 的所有 path 前置 [i]（mergeWithPrefix）
 *
 * 端口端 access 静态都是 'tree'（dispatcher 整树透传，槽位间不参与 fanout），
 * 行为分流仅在函数内部，按 inferredAccess 切换；inferredAccess 缺失时退化为安全的结构 pack。
 *
 * UX 护栏（scene-gen 专属）：tree_merge 是 DataTree 线代算子，不是 scene 装配器。
 * 仅在「结构 pack」档触发——此时把 grid2node / scene 输出接进来会得到「按 slot 前缀打包了
 * ScenePortValue 的 DataTree」，既非装配好的 scene 树、也不是干净的 item 列表，下游 scene_output
 * 解析失败 → 空输出。这里显式探测 scene 形状的 item，给出可执行的错误（指向 add_child）。
 *
 * item 档不设此护栏：item 档把各 slot 的 scene 当作独立 item 按 path concat，是「把多个 scene
 * 收集成 list 再喂给 add_child.nodes（list access）」的合法管线（见 scene-assembly 测试），
 * 不会产生静默坏结果，因此放行。
 */

import { DataTree } from '@forgeax/node-runtime';

// instanceof 在动态 import 场景下跨模块失效，改用 duck-type 检测
function isDataTree(v: unknown): v is DataTree<unknown> {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['branches'] === 'function' && typeof o['branchCount'] === 'function';
}

// ScenePortValue 形状：{ tree: SceneNodeSnapshot, focus: string }
function looksLikeScenePort(x: unknown): boolean {
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o['focus'] === 'string' && typeof o['tree'] === 'object' && o['tree'] !== null;
}

// 探测某个 slot 的 DataTree 是否承载了 scene 形状的 item（仅看首个命中即返回）。
function carriesScenePort(tree: DataTree<unknown>): boolean {
  for (const branch of tree.branches()) {
    for (const item of branch.items) {
      if (looksLikeScenePort(item)) return true;
    }
  }
  return false;
}

const SCENE_MISUSE_ERROR =
  'tree_merge merges DataTrees (wire-algebra), not scenes. ' +
  'To assemble multiple scene nodes into one multi-layer scene, use add_child ' +
  '(it grafts each scene under a parent path). Wire your grid2node/scene outputs into add_child.';

export function treeMerge(input: Record<string, unknown>): Record<string, unknown> {
  const portCount = typeof input.portCount === 'number' ? input.portCount : 2;
  const inferredAccess = typeof input.inferredAccess === 'string' ? input.inferredAccess : undefined;

  if (inferredAccess === 'item') {
    const slots: DataTree<unknown>[] = [];
    for (let i = 0; i < portCount; i++) {
      const value = input[`item_${i}`];
      if (value === undefined) continue;
      if (!isDataTree(value)) {
        return { error: `item_${i} input must be a DataTree` };
      }
      // item 档：scene 作为独立 item 收集进 list 是合法管线，不触发 scene 误用护栏。
      slots.push(value as DataTree<unknown>);
    }
    return { tree: DataTree.concatByPath(slots) };
  }

  // 默认 / list / tree → 结构 pack：第 i 个 slot 的所有 path 前置 [i]
  let result: DataTree<unknown> = DataTree.empty<unknown>();
  for (let i = 0; i < portCount; i++) {
    const value = input[`item_${i}`];
    if (value === undefined) continue;
    if (!isDataTree(value)) {
      return { error: `item_${i} input must be a DataTree` };
    }
    if (carriesScenePort(value)) return { error: SCENE_MISUSE_ERROR };
    result = result.mergeWithPrefix(value as DataTree<unknown>, i);
  }
  return { tree: result };
}
