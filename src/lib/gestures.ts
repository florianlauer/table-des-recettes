/**
 * A gesture is what one control does once: a mutation, an upload, a page-wide publication. It is a
 * typed value rather than a string, because the only thing the screen needs from it — what to make
 * inert while it runs — is decided by its *scope*, and deducing a scope by parsing a textual
 * convention produces a wrong lock at the first typo, silently.
 *
 * The whole point of the admin rework: a page used to hold one `busy` boolean, so a click on any
 * control froze all forty rows.
 */

export type GestureScope =
  // Rewrites the whole screen: "Tout publier", a rescan, a scan's images, the migration.
  | { kind: 'page' }
  // One recipe, or one scan of the list.
  | { kind: 'row'; rowId: string }
  // Competes with itself and nothing else: capturing new pages on /admin.
  | { kind: 'isolated'; id: string }

export type Gesture = { scope: GestureScope; action: string }

export function pageGesture(action: string): Gesture {
  return { scope: { kind: 'page' }, action }
}

export function rowGesture(rowId: string, action: string): Gesture {
  return { scope: { kind: 'row', rowId }, action }
}

export function isolatedGesture(id: string, action: string): Gesture {
  return { scope: { kind: 'isolated', id }, action }
}

/**
 * Identity for indexing a Record, never reparsed. Structural rather than `${kind}:${id}:${action}`:
 * a Convex id cannot contain a colon today, but a hand-built key that *depends* on that is a
 * collision waiting for the first identifier that does.
 */
export function gestureId({ scope, action }: Gesture): string {
  const parts =
    scope.kind === 'row'
      ? ['row', scope.rowId, action]
      : scope.kind === 'isolated'
        ? ['isolated', scope.id, action]
        : ['page', '', action]
  return JSON.stringify(parts)
}

/**
 * Symmetric by construction — the argument order cannot change the answer. That symmetry is the
 * decision, not a convenience: a row gesture in flight must block "Tout publier" just as "Tout
 * publier" blocks a row, because both rewrite the same recipes.
 */
export function conflicts(running: Gesture, requested: Gesture): boolean {
  const left = running.scope
  const right = requested.scope

  // An isolated gesture only ever meets itself, which is what lets a twelve-page upload run while
  // the extraction queue starts: the queue only consumes scans already written.
  if (left.kind === 'isolated' || right.kind === 'isolated')
    return (
      left.kind === 'isolated' &&
      right.kind === 'isolated' &&
      left.id === right.id
    )

  if (left.kind === 'page' || right.kind === 'page') return true

  return left.rowId === right.rowId
}

/** Whether any live gesture stands in the way of this one. */
export function isBlocked(
  running: readonly Gesture[],
  requested: Gesture,
): boolean {
  return running.some((gesture) => conflicts(gesture, requested))
}
