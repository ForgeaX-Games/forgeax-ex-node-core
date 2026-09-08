/**
 * list_get_length: 获取列表长度
 * 输入：list (array) — 任意数组
 * 输出：length (number) — 列表中的元素数量
 */

export function listGetLength(input: Record<string, unknown>): Record<string, unknown> {
  const list = input.list;

  if (!Array.isArray(list)) {
    return { error: "list is required and must be an array", length: 0 };
  }

  return { length: list.length };
}
