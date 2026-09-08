# 字典查 (dict_get_keys_by_value)

按 value list 或动态 value 从字典中反向查找 key list。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| dict | dict rank 0 | 字典 | 源字典 |
| valueList | any rank 1 | 值列 | 一维 value list |
| val_0 | any rankAny | Value 0 | 第 0 个 value |
| val_1 | any rankAny | Value 1 | 第 1 个 value；连接后自动追加 |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| keysList | string rank 2 | Key组 | 每个 value 对应一组匹配 key |
