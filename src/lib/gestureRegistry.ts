/**
 * The live gestures of one screen, and the three races that come with letting rows work
 * independently. Pure and synchronous on purpose: React state is one render behind, so it can dim a
 * button but it cannot *refuse* a second click that arrives in the same tick. This map can.
 *
 * The hook around it (`useGestures`) holds it in a ref and mirrors it into state for rendering. The
 * ref is the authority; the state is the picture.
 */
import { conflicts, gestureId, isBlocked } from './gestures'
import type { Gesture, GestureResult } from './gestures'
import type { MeasuredProgress } from './gestureProgress'

export type Run = {
  gesture: Gesture
  /** Monotonic per execution: anything arriving under a stale token is ignored. */
  token: number
  epoch: string
  pendingLabel: string
  startedAt: number
  estimateMs: number | null
  progress: MeasuredProgress | null
  /** Set when the action resolved and the run is waiting for the server state to confirm. */
  settlingSince: number | null
  /** Set when the row left the data: the outcome is republished at section level. */
  orphaned: boolean
  /** The row that left held the focus, so the republished outcome has to take it. */
  stealsFocus: boolean
}

export type Outcome = {
  gesture: Gesture
  token: number
  result: GestureResult
  /** Republished at section level because the row it belonged to is gone. */
  orphaned: boolean
  /**
   * Carried by the outcome rather than by the screen: the flag names *which* message must take the
   * focus. A boolean held next to the list can only say "one of them", which is how a `ref` shared by
   * N nodes ends up focusing the last one.
   */
  stealsFocus: boolean
}

export type RegistryState = {
  epoch: string
  nextToken: number
  runs: Record<string, Run>
  outcomes: Record<string, Outcome>
}

export function emptyRegistry(epoch: string): RegistryState {
  return { epoch, nextToken: 1, runs: {}, outcomes: {} }
}

/** Identity of one published outcome: its gesture, and the execution that produced it. */
export function outcomeKey({ gesture, token }: Outcome): string {
  return `${gestureId(gesture)}:${token}`
}

export function liveGestures(state: RegistryState): Gesture[] {
  return Object.values(state.runs).map((run) => run.gesture)
}

export function isGestureBlocked(
  state: RegistryState,
  gesture: Gesture,
): boolean {
  return isBlocked(liveGestures(state), gesture)
}

/**
 * Test-and-set, in one synchronous step, before the caller is allowed to await anything. Two clicks
 * in the same tick therefore cannot both pass: the first one is already in the map when the second
 * asks.
 *
 * Starting a gesture also clears the outcomes of everything it conflicts with — otherwise a row keeps
 * the message of its previous action next to the one now running, and the two contradict each other.
 */
export function claim(
  state: RegistryState,
  {
    gesture,
    pendingLabel,
    startedAt,
    estimateMs,
  }: {
    gesture: Gesture
    pendingLabel: string
    startedAt: number
    estimateMs: number | null
  },
):
  | { claimed: false; state: RegistryState }
  | { claimed: true; state: RegistryState; token: number } {
  if (isGestureBlocked(state, gesture)) return { claimed: false, state }

  const token = state.nextToken
  const run: Run = {
    gesture,
    token,
    epoch: state.epoch,
    pendingLabel,
    startedAt,
    estimateMs,
    progress: null,
    settlingSince: null,
    orphaned: false,
    stealsFocus: false,
  }
  return {
    claimed: true,
    token,
    state: {
      ...state,
      nextToken: token + 1,
      runs: { ...state.runs, [gestureId(gesture)]: run },
      outcomes: withoutConflicting(state.outcomes, gesture),
    },
  }
}

/** Ignores anything whose token is no longer the live one, or whose epoch has turned over. */
function current(
  state: RegistryState,
  gesture: Gesture,
  token: number,
): Run | null {
  const run = state.runs[gestureId(gesture)]
  if (!run || run.token !== token || run.epoch !== state.epoch) return null
  return run
}

export function setProgress(
  state: RegistryState,
  gesture: Gesture,
  token: number,
  progress: MeasuredProgress,
): RegistryState {
  const run = current(state, gesture, token)
  if (!run) return state
  return patch(state, gesture, { ...run, progress })
}

export function setEstimate(
  state: RegistryState,
  gesture: Gesture,
  token: number,
  estimateMs: number | null,
): RegistryState {
  const run = current(state, gesture, token)
  if (!run) return state
  return patch(state, gesture, { ...run, estimateMs })
}

/**
 * The action came back with a success, and the gesture now waits for the reactive data to show the
 * transition. Only a success waits: a refusal — a rate limit, a precondition — will never be followed
 * by any transition, so holding it pending would freeze the control on what is already the answer.
 */
export function awaitObservation(
  state: RegistryState,
  gesture: Gesture,
  token: number,
  at: number,
): RegistryState {
  const run = current(state, gesture, token)
  if (!run) return state
  return patch(state, gesture, { ...run, settlingSince: at })
}

/**
 * The row left the data. The run *and* the outcome both have to be marked: the gesture that removes
 * its own row usually settles first — the mutation answers, then the query refreshes — so by the time
 * the screen notices the row is gone there is nothing running any more, only a message with nowhere
 * left to be printed.
 *
 * Idempotent by design: the screen re-observes on every render, and a second pass must not revive a
 * focus claim the republished message has already honoured.
 */
export function markOrphaned(
  state: RegistryState,
  gesture: Gesture,
  { stealsFocus = false }: { stealsFocus?: boolean } = {},
): RegistryState {
  const key = gestureId(gesture)
  const run = state.runs[key]
  if (run && !run.orphaned)
    return patch(state, gesture, { ...run, orphaned: true, stealsFocus })
  const outcome = state.outcomes[key]
  if (!outcome || outcome.orphaned) return state
  return {
    ...state,
    outcomes: {
      ...state.outcomes,
      [key]: { ...outcome, orphaned: true, stealsFocus },
    },
  }
}

/** The republished message has taken the focus; the claim must not fire again. */
export function releaseFocusClaim(
  state: RegistryState,
  gesture: Gesture,
): RegistryState {
  const key = gestureId(gesture)
  const outcome = state.outcomes[key]
  if (!outcome || !outcome.stealsFocus) return state
  return {
    ...state,
    outcomes: { ...state.outcomes, [key]: { ...outcome, stealsFocus: false } },
  }
}

/**
 * Ends the run and publishes its outcome. Convex can refresh a query before the mutation publishes
 * its result, so the run — not the row — is what keeps the outcome alive: an orphaned run still
 * settles, and its message resurfaces at section level.
 */
export function settle(
  state: RegistryState,
  gesture: Gesture,
  token: number,
  result: GestureResult,
): RegistryState {
  const run = current(state, gesture, token)
  if (!run) return state
  const key = gestureId(gesture)
  const runs = { ...state.runs }
  delete runs[key]
  return {
    ...state,
    runs,
    outcomes: {
      ...state.outcomes,
      [key]: {
        gesture,
        token,
        result,
        orphaned: run.orphaned,
        stealsFocus: run.stealsFocus,
      },
    },
  }
}

/**
 * A new admin token, or a different scan: everything in flight belonged to the old context. Emptying
 * the map is not decoration — a dead run would keep locking the controls of the new page, and its
 * completion would land under a row it never touched.
 */
export function changeEpoch(
  state: RegistryState,
  epoch: string,
): RegistryState {
  if (epoch === state.epoch) return state
  return { epoch, nextToken: state.nextToken, runs: {}, outcomes: {} }
}

/** An edit in the form perishes the message that described the value before it. */
export function clearOutcomes(
  state: RegistryState,
  gesture: Gesture,
): RegistryState {
  return { ...state, outcomes: withoutConflicting(state.outcomes, gesture) }
}

function withoutConflicting(
  outcomes: Record<string, Outcome>,
  gesture: Gesture,
): Record<string, Outcome> {
  const kept: Record<string, Outcome> = {}
  for (const [key, outcome] of Object.entries(outcomes))
    if (!conflicts(outcome.gesture, gesture)) kept[key] = outcome
  return kept
}

function patch(
  state: RegistryState,
  gesture: Gesture,
  run: Run,
): RegistryState {
  return { ...state, runs: { ...state.runs, [gestureId(gesture)]: run } }
}
