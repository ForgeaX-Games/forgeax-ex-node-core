/**
 * listGetIndexSingle: 从列表中查找单个元素首次出现的下标
 * 输入：list (array) — 源列表；item (any) — 要查找的元素（字符串比较）
 * 输出：index (number) — 首次匹配的下标，未找到时输出 -1
 */

export function listGetIndexSingle(input: Record<string, unknown>): Record<string, unknown> {
  const list = input.list;
  const item = input.item;

  if (!Array.isArray(list)) {
    return { error: "list is required and must be an array" };
  }

  if (item === undefined || item === null) {
    return { error: "item is required" };
  }

  const target = String(item);

  for (let i = 0; i < list.length; i++) {
    const val = list[i];
    const strVal = val === null || val === undefined ? "null" : String(val);
    if (strVal === target) {
      return { index: i };
    }
  }

  return { index: -1 };
}
