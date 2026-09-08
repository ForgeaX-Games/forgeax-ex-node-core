/**
 * listRemoveByIndex: 根据索引列表删除原列表中对应元素，返回剩余元素组成的新列表
 * 输入：list (array) — 原始列表；indices (array) — 要删除的索引数组（支持负数）
 * 输出：list (array) — 删除后的新列表
 */

/**
 * 将负数索引转换为正数索引，超出范围的索引返回 -1（表示无效）
 */
function resolveIndex(index: number, length: number): number {
  const resolved = index < 0 ? length + index : index;
  return resolved >= 0 && resolved < length ? resolved : -1;
}

export function listRemoveByIndex(input: Record<string, unknown>): Record<string, unknown> {
  const list = input.list as unknown[] | undefined;
  const indices = input.indices as unknown[] | undefined;

  if (!Array.isArray(list)) {
    return { error: "list must be an array" };
  }
  if (!Array.isArray(indices)) {
    return { error: "indices must be an array" };
  }

  // 将所有索引解析为正数，并收集为集合（去重，过滤无效值）
  const toRemove = new Set<number>();
  for (const idx of indices) {
    if (typeof idx !== "number") continue;
    const resolved = resolveIndex(Math.trunc(idx), list.length);
    if (resolved !== -1) toRemove.add(resolved);
  }

  const result = list.filter((_, i) => !toRemove.has(i));

  return { list: result };
}
