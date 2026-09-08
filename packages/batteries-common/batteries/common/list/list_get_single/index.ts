/**
 * listGetSingle: 从列表中按单个下标取出对应元素
 * 输入：list (array) — 源列表；index (number) — 下标（支持负数，-1 表示最后一个）
 * 输出：item (any) — 取出的元素
 */

function resolveIndex(idx: number, length: number): number {
  const actual = idx < 0 ? length + idx : idx;
  return actual >= 0 && actual < length ? actual : -1;
}

export function listGetSingle(input: Record<string, unknown>): Record<string, unknown> {
  const list = input.list;
  const rawIndex = input.index;

  if (!Array.isArray(list)) {
    return { error: "list is required and must be an array" };
  }

  if (rawIndex === undefined || rawIndex === null) {
    return { error: "index is required" };
  }

  const idx =
    typeof rawIndex === "number"
      ? Math.trunc(rawIndex)
      : parseInt(String(rawIndex), 10);

  if (isNaN(idx)) {
    return { error: `index must be a number, got: ${rawIndex}` };
  }

  const actual = resolveIndex(idx, list.length);
  if (actual === -1) {
    return { error: `index ${idx} is out of range (list length: ${list.length})` };
  }

  return { item: list[actual] };
}
