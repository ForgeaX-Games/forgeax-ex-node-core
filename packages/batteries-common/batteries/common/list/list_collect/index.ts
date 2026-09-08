/**
 * list_collect: 跨执行轮次收集结果，用于批量处理链的出口
 * 配合 list_unpack 使用：接收链尾结果 + 引擎注入的 index/total（经 pass_through 旁路传来），
 * 在 index===0 时重置，在 collectedCount===total 时输出完整结果列表
 *
 * 状态通过模块级 Map 跨执行轮次保持，以 collectorId 区分不同收集器实例。
 * index < 0 或 total === 0 时为 no-op（对应 list_unpack trigger=false 的哨兵路径）
 *
 * 输入：item (any) — 本轮链处理结果;
 *       index (number) — 当前下标（来自 list_unpack 经 pass_through 透传）;
 *       total (number) — 列表总数（来自 list_unpack 经 pass_through 透传）;
 *       collectorId (string) — 收集器唯一标识，嵌套循环时内外层使用不同值
 * 输出：resultList (array | null) — 全部收集完成时输出完整列表，否则为 null;
 *       collectedCount (number) — 已收集的元素数量;
 *       isDone (boolean) — 是否已全部收集完成
 */

interface CollectorState {
  items: unknown[];
  total: number;
}

// 模块级状态：跨执行轮次保持，以 collectorId 为 key 区分不同收集器实例
const _store = new Map<string, CollectorState>();

export function listCollect(input: Record<string, unknown>): Record<string, unknown> {
  const collectorId = typeof input.collectorId === "string" && input.collectorId !== ""
    ? input.collectorId
    : "default";

  const total = typeof input.total === "number" && input.total > 0
    ? Math.trunc(input.total)
    : 0;

  const index = typeof input.index === "number"
    ? Math.trunc(input.index)
    : 0;

  const item = input.item;

  // 哨兵检测：index < 0 或 total === 0 表示 list_unpack trigger=false 路径，直接 no-op
  if (index < 0 || total === 0 || item === null || item === undefined) {
    const state = _store.get(collectorId);
    return {
      resultList: null,
      collectedCount: state?.items.length ?? 0,
      isDone: false,
    };
  }

  // index === 0 时重置该收集器（新一轮批次/内层循环重置开始）
  if (index === 0) {
    _store.set(collectorId, { items: [], total });
  }

  if (!_store.has(collectorId)) {
    _store.set(collectorId, { items: [], total });
  }

  const state = _store.get(collectorId)!;

  // 防止同一 index 被重复追加（重复执行同一轮时只取最新值）
  if (state.items.length > index) {
    state.items[index] = item;
  } else {
    state.items.push(item);
  }

  const collectedCount = state.items.length;
  const isDone = total > 0 && collectedCount >= total;

  return {
    resultList: isDone ? [...state.items] : null,
    collectedCount,
    isDone,
  };
}
