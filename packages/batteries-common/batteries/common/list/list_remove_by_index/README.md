# 删除 (list_remove_by_index)

按索引 list 删除一级外层 list 中的元素。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| list | any rank 1 | 列表 | 原始一级 list |
| indices | number rank 1 | 索引 | 要删除的索引 list，支持负数 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| list | any rank 1 | 列表 | 删除后的一级 list |
