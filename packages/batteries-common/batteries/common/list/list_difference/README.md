# 差集 (list_difference)

从基准一级 list 中减去子 list，返回剩余元素，保留原始顺序。

> List 在当前系统中不是基础类型；本节点处理的是基础类型值外侧的一级 list / rank-1 shape。

## 输入

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| baseList | any rank 1 | 基准 | 基准一级 list |
| subList | any rank 1 | 子集 | 要减去的一级 list |

## 输出

| 参数名 | 类型/Rank | 标签 | 说明 |
|--------|-----------|------|------|
| diffList | any rank 1 | 差集 | 差集结果 list |
