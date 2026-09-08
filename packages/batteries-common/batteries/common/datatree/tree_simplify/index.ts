/**
 * tree_simplify: 对输入 DataTree 执行 Simplify 算子（剥 branch 共享前缀）
 * 输入：tree (any) — 源 DataTree（access:tree）
 * 输出：tree (any) — simplify 后的 DataTree（access:tree）
 */

import { DataTree } from '@forgeax/node-runtime';

export function treeSimplify(input: Record<string, unknown>): Record<string, unknown> {
  const tree = input.tree;
  if (!(tree instanceof DataTree)) {
    return { error: 'tree input must be a DataTree' };
  }
  return { tree: (tree as DataTree<unknown>).simplify() };
}
