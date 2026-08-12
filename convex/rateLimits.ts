import { HOUR, RateLimiter } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'

export const SCAN_CREATION_RATE = 30
export const SCAN_CREATION_BURST = 10
export const EXTRACTION_RATE = 60
export const ILLUSTRATION_UPLOAD_RATE = 60
export const ILLUSTRATION_UPLOAD_BURST = 20
// One beautification costs 7,7x one extraction. This bounds the *calls*, which is the only thing
// bounded before billing: the price of an answer is known only once it has been paid.
export const BEAUTIFY_RATE = 40

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  scanCreation: {
    kind: 'token bucket',
    rate: SCAN_CREATION_RATE,
    period: HOUR,
    capacity: SCAN_CREATION_BURST,
  },
  // Separate from `scanCreation`: an evening spent posting dish photos must not eat the quota the
  // next morning's scanning batch needs.
  illustrationUpload: {
    kind: 'token bucket',
    rate: ILLUSTRATION_UPLOAD_RATE,
    period: HOUR,
    capacity: ILLUSTRATION_UPLOAD_BURST,
  },
  extraction: { kind: 'fixed window', rate: EXTRACTION_RATE, period: HOUR },
  beautify: { kind: 'fixed window', rate: BEAUTIFY_RATE, period: HOUR },
})
