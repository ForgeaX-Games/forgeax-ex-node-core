# 字典取 (dict_get_by_key)

按 key list 或动态 key 从字典中提取值，输出一级 value list 或动态单值。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| dict | dict rank 0 | 字典 | 源字典 |
| keyList | string rank 1 | Key列 | 一维 key list |
| key_0 | string rank 0 | Key 0 | 第 0 个 key |
| key_1 | string rank 0 | Key 1 | 第 1 个 key；连接后自动追加 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| valueList | any rank 1 | 值列 | 按 keyList 提取的一级 value list |
