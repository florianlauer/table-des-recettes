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
 */
export function getClock(): number {
  return clockMs === 0 ? Date.now() : clockMs
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
}

export function isTicking(): boolean {
  return interval !== null
}
