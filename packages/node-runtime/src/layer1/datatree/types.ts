/**
 * DataTree fundamental types and path utilities.
 *
 * Constraints (enforced by the codec):
 *   - path.length >= 1 (no empty path; scalars are stored as [0])
 *   - path elements must be non-negative finite integers
 *   - paths within a single tree must be unique (validated by DataTree.fromEntries)
 */

export type Path = readonly number[];

export interface DataTreeEntry<T> {
  readonly path: Path;
  readonly items: ReadonlyArray<T>;
}

/** Human-readable form: '{0;1;2}'. Matches the node-editor convention so logs translate across tools. */
export function pathToString(path: Path): string {
  return `{${path.join(';')}}`;
}

/** Lexicographic path comparison: shorter wins on a shared prefix. */
export function comparePaths(a: Path, b: Path): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** Path equality. */
export function pathsEqual(a: Path, b: Path): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Validate a path: non-empty, non-negative finite integers. Throws on failure. */
export function validatePath(path: Path): void {
  if (path.length === 0) {
    throw new Error('DataTree: path must have length >= 1 (use [0] for scalar)');
  }
  for (const seg of path) {
    if (!Number.isInteger(seg) || seg < 0 || !Number.isFinite(seg)) {
      throw new Error(
        `DataTree: path segments must be non-negative finite integers (got ${pathToString(path)})`,
      );
    }
  }
}
