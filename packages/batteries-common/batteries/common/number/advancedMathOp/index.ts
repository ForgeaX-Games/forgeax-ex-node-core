/**
 * AdvancedMathOp 进阶运算电池执行函数
 *
 * 行为：对输入数字执行进阶数学运算（开方、取整、最值、对数），返回计算结果
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function advancedMathOp(input: Record<string, unknown>): Record<string, unknown> {
  const a = typeof input.a === 'number' ? input.a : 0
  const b = typeof input.b === 'number' ? input.b : 0
  const op = typeof input.op === 'string' ? input.op : 'sqrt'

  let result: number

  switch (op) {
    case 'sqrt':
      result = Math.sqrt(a)
      break
    case 'cbrt':
      result = Math.cbrt(a)
      break
    case 'floor':
      result = Math.floor(a)
      break
    case 'ceil':
      result = Math.ceil(a)
      break
    case 'round':
      result = Math.round(a)
      break
    case 'min':
      result = Math.min(a, b)
      break
    case 'max':
      result = Math.max(a, b)
      break
    case 'log':
      // log_b(a)；b<=0 或 b===1 时退化为自然对数
      if (b > 0 && b !== 1) {
        result = Math.log(a) / Math.log(b)
      } else {
        result = Math.log(a)
      }
      break
    default:
      result = 0
  }

  return { result }
}
