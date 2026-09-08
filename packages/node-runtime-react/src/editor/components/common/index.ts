// Faithful shared editor primitives barrel.
export { default as StatusBar } from './StatusBar.js'
// CustomSelect (the legacy common/CustomSelect.tsx portal dropdown primitive)
// was already ported in S3 under ../canvas. Re-export it from here so consumers
// can import the shared primitive from the canonical common/ location without
// duplicating the source.
export { default as CustomSelect } from '../canvas/CustomSelect.js'
export type { CustomSelectOption } from '../canvas/CustomSelect.js'
