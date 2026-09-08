/**
 * listGetIndexByItem: 从基准列表中按内容反向查找匹配的下标
 * 输入：list (array) — 基准列表；itemList (array) — 内容数组，输出 Indices 列表；
 *       item_0, item_1, ... (string) — 动态单个内容，各自输出对应 indices 数组
 * 输出：indicesList (array) — 按 itemList 反查的 indices 数组列表（按输入 item 索引分支）；
 *       indices_0, indices_1, ... (array) — 按动态 item_* 反查的单个下标列表
 *
 * dynamicOutputs 电池：dispatcher 强制把所有数据输入端口透传为 DataTree<unknown>。
 * indicesList 是多 branch DataTree（每条 item 对应一个 branch），直接返回 DataTree passthrough。
 * indices_i 直接返回 number[]，dispatcher 按 access:list 自动 wrap 成 DataTree。
 */

import { DataTree, type DataTreeEntry } from '@forgeax/node-runtime';

function getMain(input: Record<string, unknown>, name: string): unknown {
  const v = input[name];
  if (v instanceof DataTree) {
    for (const b of v.branches()) return b.items[0];
    return undefined;
  }
  return v;
}

function getList(input: Record<string, unknown>, name: string): unknown[] | undefined {
  const v = input[name];
  if (v === undefined) return undefined;
  if (v instanceof DataTree) {
    for (const b of v.branches()) return [...b.items];
    return [];
  }
  if (Array.isArray(v)) return v;
  return undefined;
}

function findIndicesByItem(list: unknown[], target: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const val = list[i];
    const strVal = val === null || val === undefined ? null : String(val);
    if (strVal === target) {
      indices.push(i);
    }
  }
  return indices;
}

export function listGetIndexByItem(input: Record<string, unknown>): Record<string, unknown> {
  const list = getList(input, 'list');
  const portCount = typeof input.portCount === 'number' ? input.portCount : 1;

  if (list === undefined) {
    return { error: 'list is required and must be an array' };
  }

  const output: Record<string, unknown> = {};

  const itemList = getList(input, 'itemList');
  if (itemList !== undefined) {
    // 多 branch：每条 item 对应一个 branch，需要显式构造 DataTree（passthrough）
    const entries: DataTreeEntry<number>[] = itemList.map((item, i) => ({
      path: [i],
      items: item === undefined || item === null ? [] : findIndicesByItem(list, String(item)),
    }));
    output.indicesList = DataTree.fromEntries(entries);
  }

  for (let i = 0; i < portCount; i++) {
    const item = getMain(input, `item_${i}`);
    output[`indices_${i}`] = (item === undefined || item === null)
      ? []
      : findIndicesByItem(list, String(item));
  }

  return output;
}
