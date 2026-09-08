/**
 * randomNumber 电池执行函数
 *
 * 行为：在 [min, max] 范围内生成一个随机整数；seed 为 0 时使用当前时间戳（每次不同），非零时结果可复现
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */

/** mulberry32 伪随机数生成器，返回 [0, 1) 的浮点数 */
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomNumber(input: Record<string, unknown>): Record<string, unknown> {
  const min = Math.ceil(typeof input.min === "number" ? input.min : 0);
  const max = Math.floor(typeof input.max === "number" ? input.max : 100);
  const rawSeed = Math.floor(typeof input.seed === "number" ? input.seed : 0);
  const seed = rawSeed === 0 ? Date.now() : rawSeed;

  const actualMin = Math.min(min, max);
  const actualMax = Math.max(min, max);

  const random = mulberry32(seed);
  const value = actualMin + Math.floor(random() * (actualMax - actualMin + 1));

  return { number: value };
}
