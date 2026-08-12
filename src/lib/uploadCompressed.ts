import type { ReactMutation } from 'convex/react'
import type { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { compressImage } from './compress'

export type UploadPurpose = 'scan' | 'illustration'

export type UploadedFile =
  | { ok: false; error: string }
  | { ok: true; ticketId: Id<'uploadTickets'>; storageId: Id<'_storage'> }

/**
 * Compress, draw a ticket, push the bytes — everything the two attachment hooks do before they part
 * ways, one handing the blob to a scan and the other to a recipe. Written once so a change to the
 * wire format, or to what a refused upload says, cannot land on one side only.
 *
 * `purpose` is always passed, never left to the server's default: it picks the rate-limit bucket
 * *and* marks the ticket, and a caller that forgets it silently spends the scanning quota.
 */
export async function uploadCompressed(
  file: File,
  {
    adminToken,
    purpose,
    generateUploadUrl,
  }: {
    adminToken: string
    purpose: UploadPurpose
    generateUploadUrl: ReactMutation<typeof api.admin.generateUploadUrl>
  },
): Promise<UploadedFile> {
  const compressed = await compressImage(file)
  if (!compressed.ok) return { ok: false, error: compressed.message }

  const grant = await generateUploadUrl({ adminToken, purpose })
  if (!grant.ok) {
    return {
      ok: false,
      error: `${grant.error} (${Math.ceil(grant.retryAfter / 1000)} s)`,
    }
  }

  const response = await fetch(grant.uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: compressed.blob,
  })
  if (!response.ok) {
    return {
      ok: false,
      error: `Téléversement refusé (HTTP ${response.status})`,
    }
  }

  const uploaded = (await response.json()) as { storageId: string }
  return {
    ok: true,
    ticketId: grant.ticketId,
    storageId: uploaded.storageId as Id<'_storage'>,
  }
}
