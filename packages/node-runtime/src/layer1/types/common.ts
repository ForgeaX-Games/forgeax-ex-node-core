/**
 * Standard HTTP response envelope and helpers for Layer 2's HTTP adapter.
 */

/** Uniform REST envelope for every API response. */
export interface APIResponse<T = unknown> {
  /** Business or HTTP-status code. */
  code: number;
  message: string;
  /** Payload; null when the call has no data to return. */
  data: T | null;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/** Cursor / page envelope used when listing rows. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ErrorResponse {
  code: number;
  message: string;
  errors: ErrorDetail[];
  timestamp: string;
}

/** Build a uniformly-shaped success response. */
export function createResponse<T>(data: T, message = 'success', code = 200): APIResponse<T> {
  return {
    code,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
}

/** Build a uniformly-shaped error response. */
export function createErrorResponse(message: string, code = 500, errors: ErrorDetail[] = []): ErrorResponse {
  return {
    code,
    message,
    errors,
    timestamp: new Date().toISOString(),
  };
}

/** Build a uniformly-shaped paginated response. */
export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResponse<T> {
  return { items, total, page, pageSize };
}
