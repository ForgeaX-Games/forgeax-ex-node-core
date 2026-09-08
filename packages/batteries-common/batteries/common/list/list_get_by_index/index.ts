/**
 * listGetByIndex: 从基准列表中按下标提取元素
 * 输入：list (array) — 基准列表；indexList (array) — 下标数组，输出子列表；
 *       index_0, index_1, ... (number) — 动态单个下标，各自输出对应 item
 * 输出：subList (array) — 按 indexList 提取的子列表；
 *       item_0, item_1, ... (any) — 按动态 index_* 提取的单个元素，保留原始类型
 *
 * dynamicOutputs 电池：dispatcher 强制把所有数据输入端口透传为 DataTree<unknown>。
 * list 类输出端口直接返回 T[]，dispatcher 按 access:list 自动 wrap 成 DataTree。
 */

import { DataTree } from '@forgeax/node-runtime';

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

function resolveIndex(idx: number, length: number): number {
  const actual = idx < 0 ? length + idx : idx;
  return actual >= 0 && actual < length ? actual : -1;
}

export function listGetByIndex(input: Record<string, unknown>): Record<string, unknown> {
  const list = getList(input, 'list');
  const portCount = typeof input.portCount === 'number' ? input.portCount : 1;

  if (list === undefined) {
    return { error: 'list is required and must be an array' };
  }

  const output: Record<string, unknown> = {};

  const subList: unknown[] = [];
  const indexList = getList(input, 'indexList');
  if (indexList !== undefined) {
    for (const rawIdx of indexList) {
      const idx = typeof rawIdx === 'number' ? Math.trunc(rawIdx) : parseInt(String(rawIdx), 10);
      if (isNaN(idx)) { subList.push(null); continue; }
      const actual = resolveIndex(idx, list.length);
      subList.push(actual === -1 ? null : list[actual]);
    }
  }
  output.subList = subList;

  for (let i = 0; i < portCount; i++) {
    const indexVal = getMain(input, `index_${i}`);
    if (indexVal === undefined || indexVal === null) {
      output[`item_${i}`] = null;
      continue;
    }
    const idx = typeof indexVal === 'number' ? Math.trunc(indexVal) : parseInt(String(indexVal), 10);
    if (isNaN(idx)) {
      output[`item_${i}`] = null;
      continue;
    }
    const actual = resolveIndex(idx, list.length);
    if (actual === -1) {
      output[`item_${i}`] = null;
      continue;
    }
    const val = list[actual];
    output[`item_${i}`] = val === undefined ? null : val;
  }

  return output;
}
