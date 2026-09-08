/**
 * dictGetKeysByValue: 从基准字典中按值反向查找匹配的 key
 * 输入：dict (dict) — 基准字典；valueList (array) — 值数组，输出 Keys 列表；
 *       val_0, val_1, ... (any) — 动态单个值，各自输出对应 keys 数组
 * 输出：keysList (array) — 按 valueList 反查的 keys 数组列表（按输入值索引分支）；
 *       keys_0, keys_1, ... (array) — 按动态 val_* 反查的单个 key 列表
 *
 * dynamicOutputs 电池：dispatcher 强制把所有数据输入端口透传为 DataTree<unknown>。
 * keysList 是多 branch DataTree（每条 value 对应一个 branch），直接返回 DataTree passthrough。
 * keys_i 直接返回 string[]，dispatcher 按 access:list 自动 wrap 成 DataTree。
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

function findKeysByValue(dict: Record<string, unknown>, target: unknown): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(dict)) {
    if (dict[key] === target) {
      keys.push(key);
    }
  }
  return keys;
}

export function dictGetKeysByValue(input: Record<string, unknown>): Record<string, unknown> {
  const dict = getMain(input, 'dict');
  const portCount = typeof input.portCount === 'number' ? input.portCount : 1;

  if (dict === null || dict === undefined || typeof dict !== 'object' || Array.isArray(dict)) {
    return { error: 'dict is required and must be a non-array object' };
  }

  const dictObj = dict as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  const valueList = getList(input, 'valueList');
  if (valueList !== undefined) {
    // 多 branch：每条 value 对应一个 branch，需要显式构造 DataTree（passthrough）
    const entries: DataTreeEntry<string>[] = valueList.map((val, i) => ({
      path: [i],
      items: val === undefined ? [] : findKeysByValue(dictObj, val),
    }));
    output.keysList = DataTree.fromEntries(entries);
  }

  for (let i = 0; i < portCount; i++) {
    const val = getMain(input, `val_${i}`);
    output[`keys_${i}`] = val === undefined ? [] : findKeysByValue(dictObj, val);
  }

  return output;
}
