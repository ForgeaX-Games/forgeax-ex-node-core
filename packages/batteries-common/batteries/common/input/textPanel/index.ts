/**
 * TextPanel 电池执行函数
 *
 * 行为：
 * - 有上游连接（input 端口）→ 将上游值转为字符串后从 output 端口输出
 * - 无上游连接 → 将用户手动输入的文本（node.params.text）从 output 端口输出
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
function valueToString(val: unknown): string {
  if (Array.isArray(val)) {
    const lines = val.map(item => '  ' + valueToString(item))
    return '[\n' + lines.join(',\n') + '\n]'
  }
  if (typeof val === 'object' && val !== null) {
    return JSON.stringify(val, null, 2)
  }
  return String(val)
}

export function textPanel(input: Record<string, unknown>): Record<string, unknown> {
  // 有上游连接时，透传并转为字符串；对象/数组使用 JSON 格式化保留结构
  if (input.input !== undefined && input.input !== null) {
    return { output: valueToString(input.input) }
  }
  // 无上游连接时，使用用户手动输入的文本
  return { output: typeof input.text === 'string' ? input.text : '' }
}
