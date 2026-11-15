import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { gestureNoteMark, gestureNoteReading } from '../lib/gestureNote'
import { outcomeKey } from '../lib/gestureRegistry'
import type { Outcome } from '../lib/gestureRegistry'
import type { Gestures } from '../lib/useGestures'
import { GestureProgress } from './-GestureProgress'

/** A job the server owns — a lease, a generation — declared by the row that shows it. */
type ServerWork = {
  id: string
  label: string
  subject: string | null
  startedAt: number
  estimateMs: number | null
}

const ServerWorkContext = createContext<
  ((id: string, work: ServerWork | null) => void) | null
>(null)

/** How long a success stays before it leaves on its own. A failure waits for the operator. */
export const SUCCESS_DISPLAY_MS = 5_000

/** Results shown before « + N autres ». Running work is never folded away. */
const VISIBLE_OUTCOMES = 4

/** The exit fade of a closed result; DESIGN.md § Mouvement. Zero when motion is reduced. */
const EXIT_MS = 220

/**
 * The admin's one place for everything in progress and everything that came of it. It overlays the top
 * of the window instead of opening space next to the control that was pressed, so a press never moves
 * the page — which is what made the work bench read as untidy.
 *
 * Client gestures come from the registry; server jobs are declared from wherever their row lives,
 * through `ServerActivity`, so no page has to hoist its leases up to here.
 */
export function AdminActivity({
  gestures,
  children,
}: {
  gestures: Gestures
  children: ReactNode
}) {
  const [server, setServer] = useState<ReadonlyMap<string, ServerWork>>(
    () => new Map(),
  )
  const report = useCallback((id: string, work: ServerWork | null) => {
    setServer((previous) => {
      if (work === null && !previous.has(id)) return previous
      const next = new Map(previous)
      if (work === null) next.delete(id)
      else next.set(id, work)
      return next
    })
  }, [])

  return (
    <ServerWorkContext.Provider value={report}>
      <ActivityBar gestures={gestures} server={[...server.values()]} />
      {children}
    </ServerWorkContext.Provider>
  )
}

/** Puts a server job in the activity bar for as long as this is mounted. Renders nothing. */
export function ServerActivity({
  id,
  label,
  subject = null,
  startedAt,
  estimateMs,
}: {
  id: string
  label: string
  subject?: string | null
  startedAt: number
  estimateMs: number | null
}) {
  const report = useContext(ServerWorkContext)
  useEffect(() => {
    report?.(id, { id, label, subject, startedAt, estimateMs })
  }, [report, id, label, subject, startedAt, estimateMs])
  useEffect(() => () => report?.(id, null), [report, id])
  return null
}

function ActivityBar({
  gestures,
  server,
}: {
  gestures: Gestures
  server: ServerWork[]
}) {
  const [expanded, setExpanded] = useState(false)
  const runs = gestures.runs()
  // Newest first: the result of what was just pressed is the one being looked for.
  const outcomes = [...gestures.outcomes()].sort((a, b) => b.token - a.token)
  const shown = expanded ? outcomes : outcomes.slice(0, VISIBLE_OUTCOMES)
  const folded = outcomes.length - shown.length

  // The focus follows a result whose row vanished while it held the focus — accepting, publishing or
  // deleting takes the row away, and the cursor would otherwise fall back to the top of the document.
  const nodes = useRef(new Map<string, HTMLElement>())
  const claiming = outcomes.find((outcome) => outcome.stealsFocus) ?? null
  const claimingKey = claiming === null ? null : outcomeKey(claiming)
  useEffect(() => {
    if (claiming === null || claimingKey === null) return
    nodes.current.get(claimingKey)?.focus()
    gestures.releaseFocusClaim(claiming.gesture)
    // Keyed by the outcome, not by the array: the effect fires for the message that asked, once.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [claimingKey])

  if (server.length === 0 && runs.length === 0 && outcomes.length === 0)
    return null

  return (
    <section className="activity" aria-label="Activité">
      <div className="activity__inner">
        {server.map((work) => (
          <GestureProgress
            key={work.id}
            label={work.label}
            subject={work.subject}
            startedAt={work.startedAt}
            estimateMs={work.estimateMs}
            // A new lease is a new execution: the monotonic floor starts again from zero.
            token={work.startedAt}
          />
        ))}
        {runs.map((run) => (
          <GestureProgress
            key={run.token}
            label={run.pendingLabel}
            subject={run.subject}
            startedAt={run.startedAt}
            estimateMs={run.estimateMs}
            progress={run.progress}
            settlingSince={run.settlingSince}
            token={run.token}
          />
        ))}
        {shown.map((outcome) => {
          const key = outcomeKey(outcome)
          return (
            <OutcomeEntry
              key={key}
              outcome={outcome}
              onDismiss={() => gestures.dismiss(outcome)}
              nodeRef={(node) => {
                if (node === null) nodes.current.delete(key)
                else nodes.current.set(key, node)
              }}
            />
          )
        })}
        {(folded > 0 || expanded) && outcomes.length > VISIBLE_OUTCOMES && (
          <p className="activity__more">
            <button
              type="button"
              className="btn btn--quiet"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Réduire' : `+ ${folded} autres`}
            </button>
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * A success leaves on its own after `SUCCESS_DISPLAY_MS`, unless the pointer or the focus is on it: a
 * line must not vanish while it is being read. A failure is billed work gone wrong, and stays until it
 * is closed or the same gesture runs again.
 */
function OutcomeEntry({
  outcome,
  onDismiss,
  nodeRef,
}: {
  outcome: Outcome
  onDismiss: () => void
  nodeRef: (node: HTMLElement | null) => void
}) {
  const [held, setHeld] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const { result, subject } = outcome
  // A ref, not a dependency: the page re-renders on every clock tick, and a fresh callback each time
  // would restart the exit timer forever.
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (!leaving) return
    const reduced = !window.matchMedia(
      '(prefers-reduced-motion: no-preference)',
    ).matches
    const timer = window.setTimeout(
      () => dismiss.current(),
      reduced ? 0 : EXIT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [leaving])

  useEffect(() => {
    if (!result.ok || held || leaving) return
    const timer = window.setTimeout(() => setLeaving(true), SUCCESS_DISPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [result.ok, held, leaving])

  return (
    <div
      className="activity__entry activity__entry--outcome"
      data-ok={result.ok}
      data-leaving={leaving || undefined}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {/* Keyed by token upstream, so two identical messages in a row are two nodes, and the second
          one is announced instead of being swallowed as unchanged. */}
      <p className="activity__what" role="status" tabIndex={-1} ref={nodeRef}>
        <span aria-hidden="true">{gestureNoteMark(result)} </span>
        <span className="visually-hidden">{gestureNoteReading(result)} </span>
        {result.text}
        {subject && <span className="activity__subject"> · {subject}</span>}
      </p>
      <button
        type="button"
        className="activity__close"
        onClick={() => setLeaving(true)}
      >
        <span aria-hidden="true">×</span>
        <span className="visually-hidden">Fermer ce message</span>
      </button>
    </div>
  )
}
