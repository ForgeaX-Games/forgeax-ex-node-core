# 取值 (list_get_single)

从一级外层 list 中按单个 index 取出元素。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| list | any rank 1 | 列表 | 源一级 list |
| index | number rank 0 | Index | 元素下标，支持负数 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| item | any rankAny | 元素 | 取出的元素 |
