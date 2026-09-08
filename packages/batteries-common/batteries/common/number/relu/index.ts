/**
 * relu — max(0, x). Shape/Rank auto-iteration handles batched values.
 */
export function relu(input: Record<string, unknown>): Record<string, unknown> {
  const value = typeof input.value === "number" ? input.value : 0;
  return { result: Math.max(0, value) };
}
