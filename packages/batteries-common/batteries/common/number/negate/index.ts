/**
 * negate — x -> -x. Shape/Rank auto-iteration handles batched values.
 */
export function negate(input: Record<string, unknown>): Record<string, unknown> {
  const value = typeof input.value === "number" ? input.value : 0;
  return { result: -value };
}
