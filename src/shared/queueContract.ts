export const REQUEST_TIMEOUT_MS = 120_000
export const MAX_ATTEMPTS = 3
// One reservation bills at most two HTTP requests: the primary call and, after a recitation, the
// fallback call, which takes its own rate-limit unit. Every other retry lives at the queue level
// where MAX_ATTEMPTS and the rate limiter account for it. The margin keeps a replacement worker
// behind both request deadlines and the action overhead.
export const LEASE_MS = 2 * REQUEST_TIMEOUT_MS + 30_000
