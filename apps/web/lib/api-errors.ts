/**
 * The machine-readable `code` carried by every error body from the publication, agent, workflow and
 * decision routes. The code follows the HTTP status, so a client can branch on it without parsing the
 * human `error` text. The route guard adds its own refined codes (for example `rate-limited` and
 * `principal-kind-unavailable`); documented in docs/api/api-contract.md.
 */
export type ApiErrorCode =
  | 'invalid-request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'payload-too-large'
  | 'unprocessable'
  | 'rate-limited'
  | 'internal-error'
  | 'unavailable'

export function apiErrorBody(error: string, status: number): { error: string; code: ApiErrorCode } {
  return { error, code: errorCode(status) }
}

export function errorCode(status: number): ApiErrorCode {
  switch (status) {
    case 401: return 'unauthenticated'
    case 403: return 'forbidden'
    case 404: return 'not-found'
    case 409: return 'conflict'
    case 413: return 'payload-too-large'
    case 422: return 'unprocessable'
    case 429: return 'rate-limited'
    case 503: return 'unavailable'
    default: return status >= 500 ? 'internal-error' : 'invalid-request'
  }
}
