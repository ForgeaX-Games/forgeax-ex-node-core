// Image-port front-end helper: resolves a port string into a URL usable as an
// <img src>. Ported from the legacy editor (utils/imageRef.ts + the shared
// image-ref DTO), inlined here so the generic editor carries no dependency on
// an app-specific shared package.
//
// Two reference forms travel over an `image` port:
//   - library asset: JSON-serialised `{ "alias": "...", "blobId": "<sha256>" }`,
//     resolved against a content-addressed blob endpoint (immutable, cacheable).
//   - inline data URL: a `data:` string returned verbatim.
//
// The library blob base is configurable so a consumer can point it at whatever
// asset endpoint its transport exposes; it defaults to the legacy path.

export interface ImageRefLibrary {
  alias: string
  /** sha256 hex content hash. */
  blobId: string
}

export type ImageRef = ImageRefLibrary | { dataUrl: string }

/** Content-addressed blob endpoint base (immutable — no cache-bust needed). */
let libraryBlobBase = '/api/v1/library/blob'

/** Override the content-addressed blob endpoint base for library image refs. */
export function configureImageBlobBase(base: string): void {
  libraryBlobBase = base.replace(/\/+$/, '')
}

/** Encode an ImageRef into the port string form. */
export function encodeImageRef(ref: ImageRef): string {
  if ('dataUrl' in ref) return ref.dataUrl
  return JSON.stringify({ alias: ref.alias, blobId: ref.blobId })
}

/**
 * Parse a port value into an ImageRef; returns null on failure.
 *   - starts with `data:` -> dataUrl form
 *   - starts with `{` and contains alias / blobId -> library form
 */
export function parseImageRef(value: string | null | undefined): ImageRef | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:')) return { dataUrl: trimmed }
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as { alias?: unknown; blobId?: unknown }
      if (typeof obj.alias === 'string' && typeof obj.blobId === 'string' && obj.alias && obj.blobId) {
        return { alias: obj.alias, blobId: obj.blobId }
      }
    } catch {
      return null
    }
  }
  return null
}

/**
 * Resolve a port image string into an <img src> URL.
 *   - library ImageRef -> `${libraryBlobBase}/{blobId}` (content-addressed)
 *   - data: URL -> returned as-is
 *   - parse failure -> empty string
 */
export function imageRefToSrc(value: string | null | undefined): string {
  const ref = parseImageRef(value)
  if (!ref) return ''
  if ('dataUrl' in ref) return ref.dataUrl
  return `${libraryBlobBase}/${encodeURIComponent(ref.blobId)}`
}
