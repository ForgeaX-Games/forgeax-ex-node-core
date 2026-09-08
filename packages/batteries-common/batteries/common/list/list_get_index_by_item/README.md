# 多查 (list_get_index_by_item)

按内容 list 或动态 item 在一级外层 list 中反向查找匹配 index。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| list | any rank 1 | 列表 | 源一级 list |
| itemList | any rank 1 | 内容列 | 要查找的一维 item list |
| item_0 | string rank 0 | Item 0 | 第 0 个内容 |
| item_1 | string rank 0 | Item 1 | 第 1 个内容；连接后自动追加 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| indicesList | number rank 2 | 索引组 | 每个 item 对应一组匹配 index |
