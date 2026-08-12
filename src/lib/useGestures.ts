/**
 * The React shell around `gestureRegistry` — wiring only, no decisions. The ref is the authority
 * because it is synchronous; the state exists so the screen can draw what the ref holds.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { gestureId } from './gestures'
import type { Gesture } from './gestures'
import { thrownMessage } from './gestureMessages'
import type { MeasuredProgress } from './gestureProgress'
import {
  changeEpoch,
  claim,
  clearOutcomes as clearOutcomesIn,
  emptyRegistry,
  isGestureBlocked,
  markOrphaned as markOrphanedIn,
  awaitObservation,
  setProgress as setProgressIn,
  settle as settleIn,
} from './gestureRegistry'
import type {
  GestureResult,
  Outcome,
  RegistryState,
  Run,
} from './gestureRegistry'

export type ReportProgress = (progress: MeasuredProgress) => void

export type RunOptions = {
  pendingLabel: string
  estimateMs?: number | null
  /**
   * Hold the control until the reactive data shows the transition. Only for gestures whose real work
   * outlives the mutation — a beautification is scheduled in 300 ms and then runs for 26 s.
   */
  settle?: boolean
}

export type Gestures = {
  run: (
    gesture: Gesture,
    options: RunOptions,
    action: (report: ReportProgress) => Promise<GestureResult>,
  ) => Promise<void>
  running: (gesture: Gesture) => Run | null
  outcome: (gesture: Gesture) => Outcome | null
  blocked: (gesture: Gesture) => boolean
  /** Outcomes whose row is gone: the section shows them instead. */
  orphanedOutcomes: () => Outcome[]
  /** Everything in flight, so a screen can notice that a working row left the data. */
  liveGestures: () => Gesture[]
  /** The reactive data now shows what the gesture was waiting for — or a terminal state. */
  confirm: (gesture: Gesture) => void
  markOrphaned: (gesture: Gesture) => void
  clearOutcomes: (gesture: Gesture) => void
  /** Whether the focus still sits in this row, so a disappearance does not steal it from elsewhere. */
  holdsFocus: (rowId: string) => boolean
}

export function useGestures({ epoch }: { epoch: string }): Gestures {
  const [state, setState] = useState<RegistryState>(() => emptyRegistry(epoch))
  const stateRef = useRef(state)
  /** Successes waiting for the data to confirm, keyed by gesture. */
  const awaiting = useRef(
    new Map<string, { token: number; result: GestureResult }>(),
  )
  const lastFocusedRowId = useRef<string | null>(null)

  const commit = useCallback((next: RegistryState) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    if (stateRef.current.epoch === epoch) return
    awaiting.current.clear()
    commit(changeEpoch(stateRef.current, epoch))
  }, [epoch, commit])

  /**
   * At document level, not on the section: a listener scoped to the list would see the move from row
   * A to row B but not the departure to the admin token field, and A disappearing would then steal
   * the focus out of a field being typed into.
   */
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      const row =
        target instanceof Element ? target.closest('[data-row-id]') : null
      lastFocusedRowId.current = row?.getAttribute('data-row-id') ?? null
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  const run = useCallback<Gestures['run']>(
    async (
      gesture,
      { pendingLabel, estimateMs = null, settle = false },
      action,
    ) => {
      // Test-and-set before any await: this is what refuses a second click landing in the same tick,
      // a render before `disabled` could possibly reflect the first.
      const attempt = claim(stateRef.current, {
        gesture,
        pendingLabel,
        startedAt: Date.now(),
        estimateMs,
      })
      if (!attempt.claimed) return
      commit(attempt.state)
      const { token } = attempt

      const report: ReportProgress = (progress) =>
        commit(setProgressIn(stateRef.current, gesture, token, progress))

      let result: GestureResult
      try {
        result = await action(report)
      } catch (error) {
        result = thrownMessage(error)
      }

      // A refusal is already the final answer — no transition will follow a rate limit or a failed
      // precondition, so waiting for one would freeze the control on its own error message.
      if (settle && result.ok) {
        awaiting.current.set(gestureId(gesture), { token, result })
        commit(awaitObservation(stateRef.current, gesture, token, Date.now()))
        return
      }
      commit(settleIn(stateRef.current, gesture, token, result))
    },
    [commit],
  )

  const confirm = useCallback<Gestures['confirm']>(
    (gesture) => {
      const key = gestureId(gesture)
      const waiting = awaiting.current.get(key)
      if (!waiting) return
      awaiting.current.delete(key)
      commit(settleIn(stateRef.current, gesture, waiting.token, waiting.result))
    },
    [commit],
  )

  return {
    run,
    confirm,
    running: (gesture) => state.runs[gestureId(gesture)] ?? null,
    outcome: (gesture) => state.outcomes[gestureId(gesture)] ?? null,
    blocked: (gesture) => isGestureBlocked(state, gesture),
    orphanedOutcomes: () =>
      Object.values(state.outcomes).filter((outcome) => outcome.orphaned),
    liveGestures: () => Object.values(state.runs).map((live) => live.gesture),
    markOrphaned: (gesture) =>
      commit(markOrphanedIn(stateRef.current, gesture)),
    clearOutcomes: (gesture) =>
      commit(clearOutcomesIn(stateRef.current, gesture)),
    holdsFocus: (rowId) => lastFocusedRowId.current === rowId,
  }
}
