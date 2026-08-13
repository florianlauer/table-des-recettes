/**
 * What the admin is allowed to read when a query fails. The storefront already holds the rule
 * (`router.tsx`: a line that names the failure, and the one recourse that helps); the admin printed
 * `error.message` straight, which names a Convex function and a request id and never names the one
 * cause an operator can act on — a wrong token. `DESIGN.md` § Résistance forbids the technical
 * message, and § Anti-slop keeps that ban applicable here.
 */

/** The refusal `convex/auth.ts` throws. Matched on the text because it crosses the wire as one. */
const REFUSED = 'Accès administrateur refusé'

export function adminErrorLine(error: unknown): string {
  const message = messageOf(error)
  if (message.includes(REFUSED))
    return 'Jeton refusé. Vérifie le jeton administrateur.'
  return "Le serveur n'a pas répondu."
}

/**
 * A refused token is the operator's to fix, and no amount of retrying changes it. Anything else is
 * worth one more attempt, so the line carries a control rather than a dead end.
 */
export function adminErrorRetryable(error: unknown): boolean {
  return !messageOf(error).includes(REFUSED)
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  // A ConvexError crosses as `data`, which is a string here; anything else is not ours to parse.
  if (typeof error === 'string') return error
  return ''
}
