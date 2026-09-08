/**
 * dictGetByKey: 从基准字典中按键名提取值
 * 输入：dict (dict) — 基准字典；keyList (array) — 键名数组，输出值列表；
 *       key_0, key_1, ... (string) — 动态单个键名，各自输出对应 val
 * 输出：valueList (array) — 按 keyList 提取的值列表；
 *       val_0, val_1, ... (any) — 按动态 key_* 提取的单个值
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

function lookupKey(dictObj: Record<string, unknown>, key: string): unknown {
  const k = key.trim();
  return Object.prototype.hasOwnProperty.call(dictObj, k) ? dictObj[k] : null;
}

export function dictGetByKey(input: Record<string, unknown>): Record<string, unknown> {
  const dict = getMain(input, 'dict');
  const portCount = typeof input.portCount === 'number' ? input.portCount : 1;

  if (dict === null || dict === undefined || typeof dict !== 'object' || Array.isArray(dict)) {
    return { error: 'dict is required and must be a non-array object' };
  }

  const dictObj = dict as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  const keyList = getList(input, 'keyList');
  const valueList: unknown[] = [];
  if (keyList !== undefined) {
    for (const rawKey of keyList) {
      valueList.push(typeof rawKey !== 'string' || rawKey.trim() === '' ? null : lookupKey(dictObj, rawKey));
    }
  }
  output.valueList = valueList;

  for (let i = 0; i < portCount; i++) {
    const key = getMain(input, `key_${i}`);
    if (typeof key !== 'string' || key.trim() === '') {
      output[`val_${i}`] = null;
      continue;
    }
    output[`val_${i}`] = lookupKey(dictObj, key);
  }

  return output;
}
