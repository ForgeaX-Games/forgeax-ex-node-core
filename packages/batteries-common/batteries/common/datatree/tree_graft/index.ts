/**
 * tree_graft: 对输入 DataTree 执行 Graft 算子
 * 输入：tree (any) — 源 DataTree（access:tree，整棵透传）
 * 输出：tree (any) — graft 后的 DataTree（access:tree，dispatcher 直接用函数返回值作为整棵输出）
 */

import { DataTree } from '@forgeax/node-runtime';

export function treeGraft(input: Record<string, unknown>): Record<string, unknown> {
  const tree = input.tree;
  if (!(tree instanceof DataTree)) {
    return { error: 'tree input must be a DataTree' };
  }
  return { tree: (tree as DataTree<unknown>).graft() };
}
