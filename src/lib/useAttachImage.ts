import { useMutation } from 'convex/react'
import { useCallback } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { compressImage } from './compress'

export type AttachResult =
  { ok: true; scanId: Id<'scans'> } | { ok: false; error: string }

/**
 * Compress, upload, attach. Shared by the capture surface, which omits `scanId` and therefore
 * creates one scan per file, and by the correction screen, which passes one and adds a page to a
 * scan that already exists.
 */
export function useAttachImage(adminToken: string) {
  const generateUploadUrl = useMutation(api.admin.generateUploadUrl)
  const attachImage = useMutation(api.admin.attachImage)

  return useCallback(
    async (file: File, scanId?: Id<'scans'>): Promise<AttachResult> => {
      const compressed = await compressImage(file)
      if (!compressed.ok) return { ok: false, error: compressed.message }

      const grant = await generateUploadUrl({ adminToken })
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
      return attachImage({
        adminToken,
        ticketId: grant.ticketId,
        storageId: uploaded.storageId as Id<'_storage'>,
        scanId,
      })
    },
    [adminToken, attachImage, generateUploadUrl],
  )
}
