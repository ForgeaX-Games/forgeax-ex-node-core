/**
 * Path-keyed DataTree: cross-process wire payload + first-class operators.
 *
 * Layout:
 *   types.ts     — Path / DataTreeEntry / path utilities (comparePaths, pathToString, validatePath)
 *   operators.ts — pure operators (graft, flatten, trim, shift, simplify, renumber, mergeWithPrefix)
 *   tree.ts      — DataTree<T> immutable wrapper class (operator methods + JSON isomorphism)
 */

export * from './types.js';
export * from './operators.js';
export * from './tree.js';
