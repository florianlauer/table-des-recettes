import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * Deletes a blob only if it is still there. Every destructive path in T14 can be replayed — a
 * scheduled action re-run, a mutation retried after a transient failure — and a bare
 * `ctx.storage.delete` on an already-deleted id would turn each of those replays into an error.
 * Checking first is what makes "the idempotence precedes the destruction" hold at the bottom layer
 * too, not just in the guards above it.
 */
export async function deleteStoredBlob(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  const metadata = await ctx.db.system.get('_storage', storageId)
  if (metadata) await ctx.storage.delete(storageId)
}
