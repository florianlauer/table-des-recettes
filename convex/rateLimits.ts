import { HOUR, RateLimiter } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'

export const SCAN_CREATION_RATE = 30
export const SCAN_CREATION_BURST = 10
export const EXTRACTION_RATE = 60

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  scanCreation: {
    kind: 'token bucket',
    rate: SCAN_CREATION_RATE,
    period: HOUR,
    capacity: SCAN_CREATION_BURST,
  },
  extraction: { kind: 'fixed window', rate: EXTRACTION_RATE, period: HOUR },
})
