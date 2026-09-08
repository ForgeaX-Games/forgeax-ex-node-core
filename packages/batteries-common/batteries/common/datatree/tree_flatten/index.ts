/**
 * tree_flatten: 对输入 DataTree 执行 Flatten 算子
 * 输入：tree (any) — 源 DataTree（access:tree，整棵透传）
 * 输出：tree (any) — flatten 后的 DataTree（access:tree）
 */

import { DataTree } from '@forgeax/node-runtime';

export function treeFlatten(input: Record<string, unknown>): Record<string, unknown> {
  const tree = input.tree;
  if (!(tree instanceof DataTree)) {
    return { error: 'tree input must be a DataTree' };
  }
  return { tree: (tree as DataTree<unknown>).flatten() };
}
