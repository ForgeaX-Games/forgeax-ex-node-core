/**
 * Toggle 电池执行函数
 *
 * 行为：输出用户切换的布尔值（node.params.enabled）
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function toggle(input: Record<string, unknown>): Record<string, unknown> {
  // enabled 是 ToggleNode 存储参数的字段名
  const value = Boolean(input.enabled ?? input.value ?? false)
  return { value }
}
