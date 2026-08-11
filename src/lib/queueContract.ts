export const REQUEST_TIMEOUT_MS = 120_000
export const MAX_ATTEMPTS = 3
// One reservation bills at most one HTTP request, so retries live at the queue level where
// MAX_ATTEMPTS and the rate limiter already account for them. The margin keeps a replacement
// worker behind the request deadline and the action overhead.
export const LEASE_MS = REQUEST_TIMEOUT_MS + 30_000
