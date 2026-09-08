/**
 * NumberConst 电池执行函数
 *
 * 行为：输出用户通过滑条设置的数值（node.params.value）
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function numberConst(input: Record<string, unknown>): Record<string, unknown> {
  const value = typeof input.value === 'number' ? input.value : 0
  return { value }
}
