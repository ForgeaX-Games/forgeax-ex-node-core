/**
 * list_unpack: 批量遍历列表的入口电池
 *
 * trigger=false（默认）：不触发循环，输出 null 占位，list_collect 会忽略（index=-1）
 * trigger=true：向执行引擎发出 _loopBatch 信号，引擎自动将 dataList 中每个元素
 *               逐一注入下游链并执行，配合 list_collect 收集全部结果
 *
 * 嵌套循环时，内外层各设置不同 collectorId（需与对应 list_collect 的 collectorId 一致）
 *
 * 输入：dataList (array) — 待遍历的数据列表;
 *       trigger (boolean) — false 时静默，true 时启动自动循环，默认 false;
 *       collectorId (string) — 与配对的 list_collect 保持一致，用于嵌套循环配对，默认 "default"
 * 输出（由引擎在每轮迭代中注入）：
 *       item (any) — 本轮元素;
 *       index (number) — 本轮下标 (0-based);
 *       total (number) — 列表总数
 */

export function listUnpack(input: Record<string, unknown>): Record<string, unknown> {
  const dataList = input.dataList;
  const trigger = Boolean(input.trigger);
  const collectorId =
    typeof input.collectorId === "string" && input.collectorId !== ""
      ? input.collectorId
      : "default";

  if (!Array.isArray(dataList)) {
    return { error: "dataList is required and must be an array", item: null, index: -1, total: 0 };
  }

  const total = dataList.length;

  if (!trigger || total === 0) {
    // 未触发或空列表：输出哨兵值 index=-1，list_collect 会识别并跳过
    return { item: null, index: -1, total };
  }

  // trigger=true：发出循环信号
  // _loopBatch 和 _loopCollectorId 不在 battery.outputs 中，
  // 由执行引擎在 raw result 层面捕获，不作为端口输出到画布
  return {
    _loopBatch: dataList,
    _loopCollectorId: collectorId,
    total,
  };
}
