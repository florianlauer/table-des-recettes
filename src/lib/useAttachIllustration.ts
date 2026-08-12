import { useAction, useMutation } from 'convex/react'
import { useCallback } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { compressImage } from './compress'

export type AttachIllustrationResult =
  { ok: true } | { ok: false; error: string }

/**
 * Compress, upload, attach — the illustration counterpart of `useAttachImage`. Two things differ,
 * and both matter: the ticket is drawn on the illustration bucket, so an evening of dish photos
 * cannot eat the scanning quota, and the last step is an **action**, because validating the header
 * means reading the bytes and only an action can.
 */
export function useAttachIllustration(adminToken: string) {
  const generateUploadUrl = useMutation(api.admin.generateUploadUrl)
  const attachIllustration = useAction(api.illustrations.attachIllustration)

  return useCallback(
    async (
      file: File,
      recipeId: Id<'recipes'>,
    ): Promise<AttachIllustrationResult> => {
      const compressed = await compressImage(file)
      if (!compressed.ok) return { ok: false, error: compressed.message }

      const grant = await generateUploadUrl({
        adminToken,
        purpose: 'illustration',
      })
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
      return attachIllustration({
        adminToken,
        ticketId: grant.ticketId,
        storageId: uploaded.storageId as Id<'_storage'>,
        recipeId,
      })
    },
    [adminToken, attachIllustration, generateUploadUrl],
  )
}
