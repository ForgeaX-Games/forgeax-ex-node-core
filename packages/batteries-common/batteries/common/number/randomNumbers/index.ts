/**
 * Simple seeded PRNG (mulberry32)
 */
function mulberry32(a: number) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomNumbers(input: {
  count?: number;
  min?: number;
  max?: number;
  seed?: number;
  integerOnly?: boolean;
}): { numbers: number[] } {
  const count = Math.max(0, Math.floor(input.count ?? 1));
  const min = input.min ?? 0;
  const max = input.max ?? 1;
  const rawSeed = Math.floor(input.seed ?? 0);
  const seed = rawSeed === 0 ? Date.now() : rawSeed;
  const integerOnly = input.integerOnly !== false;

  const random = mulberry32(seed);
  const numbers: number[] = [];

  const actualMin = Math.min(min, max);
  const actualMax = Math.max(min, max);
  const range = actualMax - actualMin;

  for (let i = 0; i < count; i++) {
    const value = actualMin + random() * range;
    numbers.push(integerOnly ? Math.floor(value) : value);
  }

  return { numbers };
}
