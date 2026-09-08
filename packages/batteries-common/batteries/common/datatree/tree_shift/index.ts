/**
 * tree_shift: 对输入 DataTree 执行 Shift 算子（砍 path 头部 n 段）
 * 输入：tree (any) — 源 DataTree（access:tree）
 *       n (number) — 砍掉的头部段数（access:tree；未连线时走 controlInputs 默认值 1）
 * 输出：tree (any) — shift 后的 DataTree（access:tree）
 */

import { DataTree } from '@forgeax/node-runtime';

function unwrapInteger(v: unknown, fallback: number): number {
  if (v instanceof DataTree) {
    for (const b of (v as DataTree<unknown>).branches()) {
      const first = b.items[0];
      if (typeof first === 'number' && Number.isInteger(first)) return first;
      if (typeof first === 'string') {
        const parsed = parseInt(first, 10);
        if (!isNaN(parsed)) return parsed;
      }
      return fallback;
    }
    return fallback;
  }
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string') {
    const parsed = parseInt(v, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return fallback;
}

export function treeShift(input: Record<string, unknown>): Record<string, unknown> {
  const tree = input.tree;
  if (!(tree instanceof DataTree)) {
    return { error: 'tree input must be a DataTree' };
  }
  const n = unwrapInteger(input.n, 1);
  return { tree: (tree as DataTree<unknown>).shift(n) };
}
