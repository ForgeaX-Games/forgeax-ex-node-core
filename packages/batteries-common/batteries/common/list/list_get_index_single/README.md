# 查位 (list_get_index_single)

在一级外层 list 中查找元素首次出现的 index。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| list | any rank 1 | 列表 | 源一级 list |
| item | any rankAny | 元素 | 要查找的元素 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| index | number rank 0 | Index | 首次匹配下标，未找到为 -1 |
