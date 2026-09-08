/**
 * tree_renumber: 对输入 DataTree 执行 Renumber 算子（按 sibling 顺序稠密化每层 path 段）
 * 输入：tree (any) — 源 DataTree（access:tree）
 * 输出：tree (any) — renumber 后的 DataTree（access:tree）
 */

import { DataTree } from '@forgeax/node-runtime';

export function treeRenumber(input: Record<string, unknown>): Record<string, unknown> {
  const tree = input.tree;
  if (!(tree instanceof DataTree)) {
    return { error: 'tree input must be a DataTree' };
  }
  return { tree: (tree as DataTree<unknown>).renumber() };
}
