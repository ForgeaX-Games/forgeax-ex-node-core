/**
 * rangeList — generate evenly-spaced numeric and string sequences.
 */
export function rangeList(input: Record<string, unknown>): Record<string, unknown> {
  const start = typeof input.start === "number" ? input.start : 1;
  const end = typeof input.end === "number" ? input.end : 10;
  const step = typeof input.step === "number" && input.step > 0 ? input.step : 1;
  const prefix = typeof input.prefix === "string" ? input.prefix : "";

  const list: number[] = [];
  const maxItems = 10000;

  if (start <= end) {
    for (let v = start; v <= end + step * 1e-9 && list.length < maxItems; v += step) {
      list.push(Math.round(v * 1e9) / 1e9);
    }
  } else {
    for (let v = start; v >= end - step * 1e-9 && list.length < maxItems; v -= step) {
      list.push(Math.round(v * 1e9) / 1e9);
    }
  }

  const stringList = list.map(v => prefix + v);

  return { list, stringList, count: list.length };
}
