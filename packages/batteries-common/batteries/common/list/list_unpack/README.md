# 拆包 (list_unpack)

遍历一级外层 list 的入口节点；配合 Collect 收集结果。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| dataList | any rank 1 | 列表 | 待遍历的一级外层 list |
| trigger | boolean | 启动 | true 时启动循环 |
| collectorId | string | 收集ID | 与 Collect 的 collectorId 匹配 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| item | any rankAny | 元素 | 当前元素 |
| total | number rank 0 | 总数 | list 总元素数量 |
| index | number rank 0 | 下标 | 当前下标 |
