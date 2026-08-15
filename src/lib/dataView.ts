/**
 * What an admin section is looking at: one value, not four booleans.
 *
 * Every block of `/admin` used to evaluate the same ladder by hand — no token, loading, failed,
 * nothing to show, something to show — with only the noun changing, and nothing stopped two of them
 * from being true at once: a refetch that fails keeps the previous answer, so the failure and a table
 * of stale figures rendered together on a bench that spends money.
 */
export type DataView<T> =
  | { kind: 'absent' }
  | { kind: 'loading' }
  | { kind: 'failed'; error: Error }
  | { kind: 'ready'; data: T }

export function dataView<T>({
  tokenAbsent,
  loading,
  error,
  data,
}: {
  tokenAbsent: boolean
  loading: boolean
  error: Error | null
  data: T | undefined
}): DataView<T> {
  // No token is not a failure to report: nothing was asked of the server.
  if (tokenAbsent) return { kind: 'absent' }
  // A failure outranks the answer it arrived with. The operator triggers billed calls from these
  // figures; stale ones under an error message are worse than none.
  if (error) return { kind: 'failed', error }
  if (loading || data === undefined) return { kind: 'loading' }
  return { kind: 'ready', data }
}

/** The answer if there is one — for the callers that only need to know what to compute from. */
export function readyData<T>(view: DataView<T>): T | null {
  return view.kind === 'ready' ? view.data : null
}
