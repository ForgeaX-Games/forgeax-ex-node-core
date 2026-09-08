/**
 * compareGte — A >= B. Shape/Rank auto-iteration handles batched values.
 */
export function compareGte(input: Record<string, unknown>): Record<string, unknown> {
  const a = typeof input.a === "number" ? input.a : 0;
  const b = typeof input.b === "number" ? input.b : 0;
  return { result: a >= b };
}
