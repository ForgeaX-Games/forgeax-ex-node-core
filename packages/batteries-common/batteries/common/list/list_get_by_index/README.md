# 多取 (list_get_by_index)

按 index list 或动态 index 从一级外层 list 中提取元素。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| list | any rank 1 | 列表 | 源一级 list |
| indexList | number rank 1 | 索引列 | 一维 index list |
| index_0 | number rank 0 | Index 0 | 第 0 个下标 |
| index_1 | number rank 0 | Index 1 | 第 1 个下标；连接后自动追加 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| subList | any rank 1 | 子列 | 按 indexList 提取的一级 list |
