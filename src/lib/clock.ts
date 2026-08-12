/**
 * One shared tick for every progress bar on the screen, and nothing else subscribing to it.
 *
 * A 250 ms interval held in page state would rebuild all forty rows, their gesture tables and their
 * images four times a second. Only the bars need that cadence, so only the bars subscribe — and the
 * interval exists solely while at least one of them does.
 */

type Listener = () => void

const listeners = new Set<Listener>()
let interval: ReturnType<typeof setInterval> | null = null
let tick = 0
let clockMs = 0
let offsetMs = 0

export const TICK_MS = 250

/**
 * A counter, not `Date.now()`. `useSyncExternalStore` compares snapshots by identity and calls
 * `getSnapshot` more than once per render: a value that moves on every call is a render loop.
 */
export function getTick(): number {
  return tick
}

/**
 * The clock read once per tick, so every bar on one render agrees on "now". Falls back to a live
 * reading before the first subscription, so a bar's first frame is not computed against zero.
 *
 * Corrected here, and therefore correct everywhere. Almost every `startedAt` these bars measure is a
 * *server* timestamp — a lease, a scan's start — so the correction is not decoration. Passed as a prop
 * it was threaded through four component layers with a `= 0` default at each: a forgotten prop showed
 * a wrong elapsed time without failing anywhere.
 */
export function getClock(): number {
  return (clockMs === 0 ? Date.now() : clockMs) + offsetMs
}

/**
 * How far this client sits from the server, measured by `useServerClock`. One value for the whole
 * document because there is one skew: two admin screens are two routes, never mounted at once, and
 * they would measure the same drift against the same backend.
 */
export function setClockOffset(ms: number): void {
  offsetMs = Number.isFinite(ms) ? ms : 0
}

/** Constant on the server: TanStack Start renders there, and a moving value would fight hydration. */
export function getServerTick(): number {
  return 0
}

export function subscribeToTick(listener: Listener): () => void {
  listeners.add(listener)
  if (interval === null) {
    clockMs = Date.now()
    interval = setInterval(() => {
      tick += 1
      clockMs = Date.now()
      for (const notify of listeners) notify()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval)
      interval = null
    }
  }
}

/** Test seam: the module is a singleton, so a test has to be able to put it back. */
export function resetClockForTests(): void {
  listeners.clear()
  if (interval !== null) clearInterval(interval)
  interval = null
  tick = 0
  clockMs = 0
  offsetMs = 0
}

export function isTicking(): boolean {
  return interval !== null
}
