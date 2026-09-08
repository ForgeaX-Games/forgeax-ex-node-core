/**
 * seedControl — pass a numeric seed through unchanged.
 */
export function seedControl(input: Record<string, unknown>): Record<string, unknown> {
  const seed = typeof input.seed === "number" ? input.seed : 0;
  return { seed };
}
