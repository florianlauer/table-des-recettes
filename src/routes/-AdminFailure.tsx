import { adminErrorLine, adminErrorRetryable } from '../lib/adminError'

/**
 * The admin's counterpart to the storefront's `.failure`: a factual line, and the only recourse that
 * helps. It replaces seven copies of `<p role="alert">{error.message}</p>`, which published Convex
 * internals — function names, request ids — on the screen where the operator decides whether the
 * application or their own typing is at fault.
 */
export function AdminFailure({
  error,
  retry,
}: {
  error: unknown
  /** Omitted where the caller has nothing to re-run; a refused token never gets one anyway. */
  retry?: () => void
}) {
  return (
    <p className="admin-page__failure" role="alert">
      {adminErrorLine(error)}
      {retry && adminErrorRetryable(error) && (
        <>
          {' '}
          <button
            type="button"
            className="admin-page__retry"
            onClick={() => retry()}
          >
            Réessayer
          </button>
        </>
      )}
    </p>
  )
}
