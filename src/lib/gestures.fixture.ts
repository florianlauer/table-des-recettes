import type { Outcome, Run } from './gestureRegistry'
import type { Gestures } from './useGestures'

/**
 * A registry stand-in for component tests: every gesture reads the same run, outcome and lock. The
 * registry itself is covered by `gestureRegistry.test.ts`.
 */
export function fakeGestures({
  running = null,
  outcome = null,
  blocked = false,
}: {
  running?: Run | null
  outcome?: Outcome | null
  blocked?: boolean
} = {}): Gestures {
  return {
    run: async () => {},
    confirm: () => {},
    running: () => running,
    outcome: () => outcome,
    blocked: () => blocked,
    orphanedOutcomes: () => [],
    liveGestures: () => [],
    markOrphaned: () => {},
    releaseFocusClaim: () => {},
    clearOutcomes: () => {},
    holdsFocus: () => false,
  }
}
