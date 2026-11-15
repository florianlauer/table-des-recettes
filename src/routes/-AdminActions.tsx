import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { ReactNode } from 'react'

type Reasons = (id: string, reason: string | null) => void

const ReasonsContext = createContext<Reasons | null>(null)

/**
 * A row of controls and the one line under it that says why some of them are inert. The line is always
 * there, empty or not: a reason that appeared under its own button pushed the row down on the first
 * keystroke, and widened the button it hung from.
 */
export function AdminActions({ children }: { children: ReactNode }) {
  const [reasons, setReasons] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  )
  const report = useCallback<Reasons>((id, reason) => {
    setReasons((previous) => {
      if (previous.get(id) === (reason ?? undefined)) return previous
      const next = new Map(previous)
      if (reason === null) next.delete(id)
      else next.set(id, reason)
      return next
    })
  }, [])

  return (
    <ReasonsContext.Provider value={report}>
      <div className="admin-actions">
        <div className="admin-actions__row">{children}</div>
        <p className="admin-actions__reasons">
          {[...reasons].map(([id, reason]) => (
            <span key={id} id={id}>
              {reason}{' '}
            </span>
          ))}
        </p>
      </div>
    </ReasonsContext.Provider>
  )
}

/**
 * Publishes a control's reason into its group's line. Returns `false` outside a group, where the
 * control has to print the reason itself.
 */
export function useGroupedReason(id: string, reason: string | null): boolean {
  const report = useContext(ReasonsContext)
  useEffect(() => {
    report?.(id, reason)
  }, [report, id, reason])
  useEffect(() => () => report?.(id, null), [report, id])
  return report !== null
}
