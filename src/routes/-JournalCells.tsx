/**
 * The two cells the extraction journal and the generation journal print identically.
 *
 * Not a shared table: the two have different columns — one counts repairs, the other counts
 * verdicts — and a component parameterised over both would be a wider interface than the two it
 * replaces. What was byte-for-byte identical is the row header carrying the « en service » flag, and
 * the identity line under it.
 */

/** The model, and whether this is the configuration the deployment is running right now. */
export function JournalModelCell({
  model,
  isCurrent,
}: {
  model: string
  isCurrent: boolean
}) {
  return (
    <th scope="row">
      {model}
      {isCurrent && <span className="admin-table__flag"> en service</span>}
    </th>
  )
}

/**
 * The identity of a reading is more than one thing, and the rest would make the model column
 * unreadable — so it rides under it. `schemaVersion` is absent from the generation journal, which
 * has none: the segment simply does not print.
 */
export function JournalIdentityLine({
  servedProvider,
  promptVersion,
  schemaVersion,
  failureKinds,
}: {
  servedProvider: string | null
  promptVersion: string
  schemaVersion?: string
  failureKinds: readonly { kind: string; count: number }[]
}) {
  return (
    <p>
      {servedProvider ?? 'provider inconnu'} · prompt {promptVersion}
      {schemaVersion !== undefined && ` · schéma ${schemaVersion}`}
      {failureKinds.length > 0 &&
        ` · ${failureKinds
          .map(({ kind, count }) => `${kind} ${count}`)
          .join(', ')}`}
    </p>
  )
}
