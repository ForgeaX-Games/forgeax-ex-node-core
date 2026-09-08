# 收集 (list_collect)

跨循环轮次收集结果，输出一级外层 result list。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| item | any rankAny | 元素 | 本轮结果 |
| index | number rank 0 | 下标 | 当前下标 |
| total | number rank 0 | 总数 | list 总元素数量 |
| collectorId | string | 收集ID | 收集器唯一标识 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| resultList | any rank 1 | 结果 | 完成时输出一级结果 list，未完成时为 null |
| collectedCount | number rank 0 | 已收集 | 已收集数量 |
| isDone | boolean rank 0 | 完成 | 是否收集完成 |
