/**
 * The admin clock, corrected against the server's.
 *
 * Every elapsed time on these screens is measured against a **server** timestamp — a beautification
 * lease, an extraction lease, a scan's `startedAt`. A client thirty seconds off would therefore show
 * a wrong elapsed time and a bar already past its estimate. `/admin` corrected this on its own; the
 * other two screens did not, and one of them is where the extraction bar lives.
 */
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import { setClockOffset } from './clock'

/**
 * Returns `now` for what is spelled out in words — the age of a lease, a scheduled retry. The progress
 * bars need nothing from it: the correction is published into `clock`, which they already read.
 */
export function useServerClock(
  adminToken: string,
  { intervalMs = 15_000 }: { intervalMs?: number } = {},
): { now: number } {
  const serverTime = useMutation(api.admin.serverTime)
  const [offset, setOffset] = useState(0)
  const [clientNow, setClientNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(
      () => setClientNow(Date.now()),
      intervalMs,
    )
    return () => window.clearInterval(interval)
  }, [intervalMs])

  useEffect(() => {
    if (!adminToken) return
    // A reading launched under the previous token must not overwrite the current one if it lands
    // later: `stale` is what the cleanup flips.
    let stale = false
    void serverTime({ adminToken })
      .then((now) => {
        if (stale) return
        const measured = now - Date.now()
        setOffset(measured)
        setClockOffset(measured)
        setClientNow(Date.now())
      })
      // A failed reading leaves the offset where it was rather than guessing one.
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [adminToken, serverTime])

  return { now: clientNow + offset }
}
