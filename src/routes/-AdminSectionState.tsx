import { AdminFailure } from './-AdminFailure'
import type { DataView } from '../lib/dataView'

/**
 * The three states an admin section can be in before it has anything to show. Written once: the
 * ladder was copied into every block, and an operator with no token used to read the same silence as
 * an operator whose query had failed.
 *
 * `absent` is the only wording that changes from block to block — a token is missing *for something*
 * — so it is the only string passed in.
 */
export function AdminSectionState({
  view,
  absent,
  retry,
}: {
  view: DataView<unknown>
  absent: string
  retry: () => void
}) {
  switch (view.kind) {
    case 'absent':
      return <p className="empty">{absent}</p>
    case 'loading':
      return <p>Chargement…</p>
    case 'failed':
      return <AdminFailure error={view.error} retry={retry} />
    case 'ready':
      return null
  }
}
