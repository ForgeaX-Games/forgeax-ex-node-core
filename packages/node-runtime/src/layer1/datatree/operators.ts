/**
 * Pure DataTree operators: take an entries array, return an entries array.
 *
 * The DataTree<T> methods in tree.ts are thin wrappers over these functions.
 * Splitting the operators out lets the dispatcher, tests, and other low-level
 * paths consume them directly without binding to the wrapper class.
 *
 * Convention: every operator returns entries that already satisfy
 * "paths unique, items within a branch homogeneous". Sorting is the caller's
 * concern (DataTree.fromEntries re-sorts on construction).
 */

import {
  type DataTreeEntry,
  type Path,
  pathToString,
} from './types.js';

/** Graft: lift each item up by one level into its own branch. {A}=[a,b,c] → {A;0}=[a],{A;1}=[b],{A;2}=[c]. Empty branches are dropped. */
export function graftEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTreeEntry<T>[] {
  const out: DataTreeEntry<T>[] = [];
  for (const { path, items } of entries) {
    items.forEach((item, idx) => {
      out.push({ path: [...path, idx], items: [item] });
    });
  }
  return out;
}

/** Flatten: collapse every branch (in order) into a single {0}. An empty tree stays empty (not {0}=[]). */
export function flattenEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTreeEntry<T>[] {
  if (entries.length === 0) return [];
  const all: T[] = [];
  for (const { items } of entries) all.push(...items);
  return [{ path: [0], items: all }];
}

/** Trim: drop the last N path segments; entries that share a new path have their items concatenated. The remaining path must keep length >= 1. */
export function trimEntries<T>(
  entries: ReadonlyArray<DataTreeEntry<T>>,
  n: number,
): DataTreeEntry<T>[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`DataTree: trim n must be non-negative integer (got ${n})`);
  }
  if (n === 0) return entries.map(e => ({ path: [...e.path], items: [...e.items] }));
  return reduceByNewPath(entries, ({ path }) => {
    if (path.length - n < 1) {
      throw new Error(`DataTree: trim(${n}) would empty path ${pathToString(path)}`);
    }
    return path.slice(0, path.length - n);
  });
}

/** Shift: drop the first N path segments. The remaining path must keep length >= 1. */
export function shiftEntries<T>(
  entries: ReadonlyArray<DataTreeEntry<T>>,
  n: number,
): DataTreeEntry<T>[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`DataTree: shift n must be non-negative integer (got ${n})`);
  }
  if (n === 0) return entries.map(e => ({ path: [...e.path], items: [...e.items] }));
  return reduceByNewPath(entries, ({ path }) => {
    if (path.length - n < 1) {
      throw new Error(`DataTree: shift(${n}) would empty path ${pathToString(path)}`);
    }
    return path.slice(n);
  });
}

/**
 * Simplify: strip the longest prefix shared by every branch, but always keep
 * at least one segment behind so no path is emptied. Trees with 0 or 1 branch
 * pass through unchanged. Simplification is explicit by call; never implicit.
 */
export function simplifyEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTreeEntry<T>[] {
  if (entries.length <= 1) {
    return entries.map(e => ({ path: [...e.path], items: [...e.items] }));
  }
  const first = entries[0]!.path;
  let common = first.length;
  for (let i = 1; i < entries.length; i++) {
    const p = entries[i]!.path;
    let j = 0;
    while (j < common && j < p.length && first[j] === p[j]) j++;
    common = j;
    if (common === 0) break;
  }
  let minLen = Infinity;
  for (const e of entries) if (e.path.length < minLen) minLen = e.path.length;
  const cutoff = Math.min(common, minLen - 1);
  if (cutoff <= 0) {
    return entries.map(e => ({ path: [...e.path], items: [...e.items] }));
  }
  return entries.map(({ path, items }) => ({
    path: path.slice(cutoff),
    items: [...items],
  }));
}

/**
 * Renumber: keep sibling order but compact every layer's path segments
 * down to 0..N. Use after trim/shift/merge to remove holes and yield a
 * stable serialised form.
 */
export function renumberEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTreeEntry<T>[] {
  if (entries.length === 0) return [];
  const sorted = entries.slice().sort((a, b) => {
    const len = Math.min(a.path.length, b.path.length);
    for (let i = 0; i < len; i++) if (a.path[i] !== b.path[i]) return a.path[i]! - b.path[i]!;
    return a.path.length - b.path.length;
  });
  let maxDepth = 0;
  for (const e of sorted) if (e.path.length > maxDepth) maxDepth = e.path.length;
  const layerBuckets: Map<string, Map<number, number>>[] = [];
  for (let d = 0; d < maxDepth; d++) layerBuckets.push(new Map());
  return sorted.map(({ path, items }) => {
    const newPath: number[] = [];
    let parentKey = '';
    for (let d = 0; d < path.length; d++) {
      const orig = path[d]!;
      const layer = layerBuckets[d]!;
      let bucket = layer.get(parentKey);
      if (!bucket) {
        bucket = new Map();
        layer.set(parentKey, bucket);
      }
      let mapped = bucket.get(orig);
      if (mapped === undefined) {
        mapped = bucket.size;
        bucket.set(orig, mapped);
      }
      newPath.push(mapped);
      parentKey += `.${orig}`;
    }
    return { path: newPath, items: [...items] };
  });
}

/**
 * MergeWithPrefix: prepend [prefix] to every path of `other`, then concat onto
 * `base`. `base` paths stay as-is. Throws on path collision.
 *
 * Idiomatic multi-way merge:
 *   DataTree.empty<T>().mergeWithPrefix(t0, 0).mergeWithPrefix(t1, 1) ...
 */
export function mergeEntriesWithPrefix<T>(
  base: ReadonlyArray<DataTreeEntry<T>>,
  other: ReadonlyArray<DataTreeEntry<T>>,
  prefix: number,
): DataTreeEntry<T>[] {
  if (!Number.isInteger(prefix) || prefix < 0 || !Number.isFinite(prefix)) {
    throw new Error(`DataTree: merge prefix must be non-negative finite integer (got ${prefix})`);
  }
  const seen = new Set<string>();
  const out: DataTreeEntry<T>[] = [];
  for (const { path, items } of base) {
    seen.add(path.join('.'));
    out.push({ path: [...path], items: [...items] });
  }
  for (const { path, items } of other) {
    const newPath = [prefix, ...path];
    const key = newPath.join('.');
    if (seen.has(key)) {
      throw new Error(`DataTree: merge collision at ${pathToString(newPath)}`);
    }
    seen.add(key);
    out.push({ path: newPath, items: [...items] });
  }
  return out;
}

/**
 * ConcatByPath: union the paths across all slots; for each path, concat the
 * items from every slot in slot order.
 *
 * Used by tree_merge when inferredAccess === 'item' to do an item-level merge:
 * each branch's path stays, items inside the branch get concatenated across
 * slots. Slots that lack a given path simply skip it.
 *
 * Example:
 *   slots=[{[0]:[a,b],[1]:[c]}, {[0]:[x],[1]:[y,z]}]
 *   → {[0]:[a,b,x], [1]:[c,y,z]}
 */
export function concatEntriesByPath<T>(
  slots: ReadonlyArray<ReadonlyArray<DataTreeEntry<T>>>,
): DataTreeEntry<T>[] {
  const grouped = new Map<string, { path: Path; items: T[] }>();
  for (const slot of slots) {
    for (const { path, items } of slot) {
      const key = path.join('.');
      let bucket = grouped.get(key);
      if (!bucket) {
        bucket = { path: [...path], items: [] };
        grouped.set(key, bucket);
      }
      bucket.items.push(...items);
    }
  }
  return [...grouped.values()];
}

/** Internal: group entries by a caller-computed new path; concatenate items in first-seen order. */
function reduceByNewPath<T>(
  entries: ReadonlyArray<DataTreeEntry<T>>,
  fn: (entry: DataTreeEntry<T>) => Path,
): DataTreeEntry<T>[] {
  const grouped = new Map<string, { path: Path; items: T[] }>();
  for (const entry of entries) {
    const newPath = fn(entry);
    const key = newPath.join('.');
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = { path: [...newPath], items: [] };
      grouped.set(key, bucket);
    }
    bucket.items.push(...entry.items);
  }
  return [...grouped.values()];
}
