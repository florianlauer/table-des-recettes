import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { getClock, getServerTick, getTick, subscribeToTick } from '../lib/clock'
import { gestureNoteMark, gestureNoteReading } from '../lib/gestureNote'
import { progressView } from '../lib/gestureProgress'
import type { MeasuredProgress } from '../lib/gestureProgress'
import { outcomeKey } from '../lib/gestureRegistry'
import type { Outcome } from '../lib/gestureRegistry'
import type { Gestures } from '../lib/useGestures'

/** A job the server owns — a lease, a generation — declared by whatever screen knows of it. */
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
 * Client gestures come from the registry; server jobs are declared from wherever they are known,
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
  const folded = expanded ? 0 : Math.max(0, outcomes.length - VISIBLE_OUTCOMES)

  // The focus follows a result whose control vanished while it held the focus — accepting, publishing
  // or deleting takes the control away, and the cursor would otherwise fall back to the top of the
  // document. The claiming result is never folded, so its node exists by the time this runs.
  const nodes = useRef(new Map<string, HTMLElement>())
  const claiming = outcomes.find((outcome) => outcome.stealsFocus) ?? null
  const claimingKey = claiming === null ? null : outcomeKey(claiming)
  useEffect(() => {
    if (claiming === null || claimingKey === null) return
    const node = nodes.current.get(claimingKey)
    if (!node) return
    node.focus()
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
          <RunEntry
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
          <RunEntry
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
        {/* Folded results stay mounted, only hidden: a success has to leave on its own timer even
            while it sits behind « + N autres ». */}
        {outcomes.map((outcome, index) => {
          const key = outcomeKey(outcome)
          return (
            <OutcomeEntry
              key={key}
              outcome={outcome}
              hidden={
                !expanded && index >= VISIBLE_OUTCOMES && !outcome.stealsFocus
              }
              onDismiss={() => gestures.dismiss(outcome)}
              nodeRef={(node) => {
                if (node === null) nodes.current.delete(key)
                else nodes.current.set(key, node)
              }}
            />
          )
        })}
        {outcomes.length > VISIBLE_OUTCOMES && (
          <p className="activity__more">
            <button
              type="button"
              className="btn btn--quiet"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? 'Réduire'
                : folded === 1
                  ? '+ 1 autre'
                  : `+ ${folded} autres`}
            </button>
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * One running line: what runs, on what, for how long, and — when it can be known — how far along. A
 * client gesture and a job the server owns draw the same line.
 *
 * Nothing is drawn before `PROGRESS_DELAY_MS`: a mutation answering in 250 ms must not flash a line.
 *
 * It is the only thing on the page beating at 250 ms. The tick comes from a shared store rather than
 * page state, so a running line re-renders itself and nothing else. `getClock` is already corrected
 * against the server, which is what `startedAt` usually comes from.
 */
function RunEntry({
  label,
  subject = null,
  startedAt,
  estimateMs,
  progress = null,
  settlingSince = null,
  token,
}: {
  /** The pending label of the gesture, or the name of the server job. */
  label: string
  /** What it acts on — a recipe title, a scan. */
  subject?: string | null
  /** A server timestamp for a lease, a client one for an upload. */
  startedAt: number
  estimateMs: number | null
  progress?: MeasuredProgress | null
  settlingSince?: number | null
  /** Resets the monotonic floor: a new execution starts from zero, not from the last maximum. */
  token?: number
}) {
  const whatId = useId()
  useSyncExternalStore(subscribeToTick, getTick, getServerTick)
  const now = getClock()

  // Component-local, written in an effect and never during render: the floor belongs to what is
  // displayed, not to the shared registry.
  const floor = useRef(0)
  const seenToken = useRef(token)
  if (seenToken.current !== token) {
    seenToken.current = token
    floor.current = 0
  }

  const view = progressView({
    startedAt,
    now,
    progress,
    estimateMs,
    floor: floor.current,
    settlingSince,
  })

  useEffect(() => {
    floor.current = view.nextFloor
  }, [view.nextFloor])

  if (!view.visible) return null

  return (
    <div className="activity__entry">
      <p className="activity__what" id={whatId}>
        <b>{label}</b>
        {subject && <span className="activity__subject"> · {subject}</span>}
      </p>
      <p className="activity__time">{view.text}</p>
      {view.fraction !== null && (
        <div
          className="activity__bar"
          role="progressbar"
          aria-labelledby={whatId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.fraction * 100)}
          aria-valuetext={view.valueText}
        >
          {/* `scaleX`, not `width`: the fill eases between two ticks without a layout pass. */}
          <div
            className="activity__fill"
            style={{ transform: `scaleX(${view.fraction})` }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * A success leaves on its own after `SUCCESS_DISPLAY_MS`, unless the pointer or the focus is on it: a
 * line must not vanish while it is being read. A failure is billed work gone wrong, and stays until it
 * is closed or the same gesture runs again.
 */
function OutcomeEntry({
  outcome,
  hidden,
  onDismiss,
  nodeRef,
}: {
  outcome: Outcome
  hidden: boolean
  onDismiss: () => void
  nodeRef: (node: HTMLElement | null) => void
}) {
  // Two flags, not one: the pointer leaving must not release a line the focus still holds.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
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
    if (!result.ok || hovered || focused || leaving) return
    const timer = window.setTimeout(() => setLeaving(true), SUCCESS_DISPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [result.ok, hovered, focused, leaving])

  return (
    <div
      className="activity__entry activity__entry--outcome"
      // The line holding the focus is never folded away from under it, claim released or not.
      hidden={hidden && !focused}
      data-ok={result.ok}
      data-leaving={leaving || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // Moving between the message and its close button stays inside the line.
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false)
      }}
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
        onClick={(event) => {
          // The closed line is about to unmount with the focus in it: hand the focus to a neighbour's
          // close button first, so the next Tab does not start over from the top of the document.
          const entry = event.currentTarget.closest('.activity__entry')
          const neighbour = [
            entry?.nextElementSibling,
            entry?.previousElementSibling,
          ]
            .map((node) =>
              node instanceof HTMLElement && !node.hidden
                ? node.querySelector<HTMLElement>('.activity__close')
                : null,
            )
            .find((node) => node != null)
          neighbour?.focus()
          setLeaving(true)
        }}
      >
        <span aria-hidden="true">×</span>
        <span className="visually-hidden">Fermer ce message</span>
      </button>
    </div>
  )
}
