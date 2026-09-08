/**
 * BasicMathOp 基础运算电池执行函数
 *
 * 行为：对两个输入数字执行基础数学运算（加减乘除幂取余绝对值），返回计算结果
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function basicMathOp(input: Record<string, unknown>): Record<string, unknown> {
  const a = typeof input.a === 'number' ? input.a : 0
  const b = typeof input.b === 'number' ? input.b : 0
  const op = typeof input.op === 'string' ? input.op : '+'

  let result: number

  switch (op) {
    case '+':
      result = a + b
      break
    case '-':
      result = a - b
      break
    case '*':
      result = a * b
      break
    case '/':
      result = b !== 0 ? a / b : 0
      break
    case '^':
      result = Math.pow(a, b)
      break
    case '%':
      result = b !== 0 ? a % b : 0
      break
    case 'abs':
      result = Math.abs(a)
      break
    default:
      result = 0
  }

  return { result }
}
