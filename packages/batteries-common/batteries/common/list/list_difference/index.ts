/**
 * list_difference: 从基准列表中减去子列表，返回差值列表
 * 输入：baseList (array) — 基准列表; subList (array) — 要减去的子列表
 * 输出：diffList (array) — 差值列表（保留在基准列表中但不在子列表中的元素）
 *
 * 比较方式：先尝试值相等（===），对象/数组类型则用 JSON 序列化比较。
 * 保留原始顺序，每个匹配的元素只删除一次（多重集差值语义）。
 */

function toKey(value: unknown): string {
  if (value === null) return "__null__";
  if (value === undefined) return "__undefined__";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function listDiff(baseList: unknown[], subList: unknown[]): unknown[] {
  // 构建子列表的多重集计数表
  const subCount = new Map<string, number>();
  for (const item of subList) {
    const key = toKey(item);
    subCount.set(key, (subCount.get(key) ?? 0) + 1);
  }

  const result: unknown[] = [];
  for (const item of baseList) {
    const key = toKey(item);
    const count = subCount.get(key) ?? 0;
    if (count > 0) {
      // 消耗一次匹配
      subCount.set(key, count - 1);
    } else {
      result.push(item);
    }
  }
  return result;
}

export function listDifference(input: Record<string, unknown>): Record<string, unknown> {
  const baseList = Array.isArray(input.baseList) ? (input.baseList as unknown[]) : null;
  const subList = Array.isArray(input.subList) ? (input.subList as unknown[]) : [];

  if (baseList === null) {
    return { error: "baseList is required and must be an array" };
  }

  const diffList = listDiff(baseList, subList);

  return { diffList };
}
