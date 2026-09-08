/**
 * DataTree<T>: path-keyed immutable data tree (the runtime payload of a wire).
 *
 * Modelled on the upstream node-editor's `GH_Structure<T>`:
 *   - branch key is an integer-sequence path (int[]) — serialisable, comparable, usable as Map key
 *   - items within a branch are homogeneous; items across branches may be heterogeneous
 *   - instances are immutable; every operator returns a new instance
 *
 * Serialisation: toJSON returns the internal entries array verbatim (JSON.stringify-friendly).
 * Deserialisation goes through fromJSON (== fromEntries) so path uniqueness is re-validated.
 */

import {
  type DataTreeEntry,
  type Path,
  comparePaths,
  pathsEqual,
  pathToString,
  validatePath,
} from './types.js';
import {
  graftEntries,
  flattenEntries,
  trimEntries,
  shiftEntries,
  simplifyEntries,
  renumberEntries,
  mergeEntriesWithPrefix,
  concatEntriesByPath,
} from './operators.js';

export class DataTree<T> {
  private constructor(private readonly _entries: ReadonlyArray<DataTreeEntry<T>>) {}

  /** Validate, deep-copy, and lex-sort entries before constructing. Throws on duplicate or invalid paths. */
  static fromEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTree<T> {
    const seen = new Set<string>();
    const normalized: DataTreeEntry<T>[] = [];
    for (const e of entries) {
      validatePath(e.path);
      const key = e.path.join('.');
      if (seen.has(key)) {
        throw new Error(`DataTree: duplicate path ${pathToString(e.path)}`);
      }
      seen.add(key);
      normalized.push({ path: [...e.path], items: [...e.items] });
    }
    normalized.sort((a, b) => comparePaths(a.path, b.path));
    return new DataTree<T>(normalized);
  }

  /** Scalar: single branch [0] holding a single item. */
  static fromItem<T>(value: T): DataTree<T> {
    return new DataTree<T>([{ path: [0], items: [value] }]);
  }

  /** List: single branch [0] holding N items (input order preserved). */
  static fromList<T>(values: ReadonlyArray<T>): DataTree<T> {
    return new DataTree<T>([{ path: [0], items: [...values] }]);
  }

  /** Empty tree: 0 branches. */
  static empty<T>(): DataTree<T> {
    return new DataTree<T>([]);
  }

  /** JSON deserialisation reuses the validation in fromEntries. */
  static fromJSON<T>(arr: ReadonlyArray<DataTreeEntry<T>>): DataTree<T> {
    return DataTree.fromEntries(arr);
  }

  /**
   * Cross-module-safe DataTree identity check (duck-typing).
   * Dynamic imports produce separate module instances which break `instanceof`.
   * This structural check works across module boundaries.
   */
  static isDataTree(v: unknown): v is DataTree<unknown> {
    if (v === null || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return typeof o['branches'] === 'function' && typeof o['branchCount'] === 'function' && typeof o['toJSON'] === 'function';
  }

  /** JSON serialisation: returns the immutable internal entries array. */
  toJSON(): ReadonlyArray<DataTreeEntry<T>> {
    return this._entries;
  }

  /** Iterate every branch in lexicographic path order. */
  *branches(): IterableIterator<DataTreeEntry<T>> {
    for (const e of this._entries) yield e;
  }

  /** Look up the items at a path; returns undefined when missing. */
  get(path: Path): readonly T[] | undefined {
    for (const e of this._entries) {
      if (pathsEqual(e.path, path)) return e.items;
    }
    return undefined;
  }

  branchCount(): number {
    return this._entries.length;
  }

  /** Sum of items.length across every branch. */
  itemCount(): number {
    let n = 0;
    for (const e of this._entries) n += e.items.length;
    return n;
  }

  graft(): DataTree<T> {
    return DataTree.fromEntries(graftEntries(this._entries));
  }

  flatten(): DataTree<T> {
    return DataTree.fromEntries(flattenEntries(this._entries));
  }

  trim(n: number): DataTree<T> {
    return DataTree.fromEntries(trimEntries(this._entries, n));
  }

  shift(n: number): DataTree<T> {
    return DataTree.fromEntries(shiftEntries(this._entries, n));
  }

  simplify(): DataTree<T> {
    return DataTree.fromEntries(simplifyEntries(this._entries));
  }

  renumber(): DataTree<T> {
    return DataTree.fromEntries(renumberEntries(this._entries));
  }

  mergeWithPrefix(other: DataTree<T>, prefix: number): DataTree<T> {
    return DataTree.fromEntries(mergeEntriesWithPrefix(this._entries, other._entries, prefix));
  }

  /** Concatenate items across multiple slots that share a path (item-level merge). */
  static concatByPath<T>(slots: ReadonlyArray<DataTree<T>>): DataTree<T> {
    return DataTree.fromEntries(
      concatEntriesByPath(slots.map(s => s._entries)),
    );
  }

  /** Map each item; paths and items.length remain unchanged. */
  map<U>(fn: (value: T, path: Path, idx: number) => U): DataTree<U> {
    const mapped: DataTreeEntry<U>[] = this._entries.map(({ path, items }) => ({
      path,
      items: items.map((v, i) => fn(v, path, i)),
    }));
    return new DataTree<U>(mapped);
  }
}
