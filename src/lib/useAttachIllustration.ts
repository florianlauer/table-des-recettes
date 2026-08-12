import { useAction, useMutation } from 'convex/react'
import { useCallback } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { uploadCompressed } from './uploadCompressed'
import type { UploadPhase } from './uploadProgress'

export type AttachIllustrationResult =
  { ok: true } | { ok: false; error: string }

/**
 * The illustration counterpart of `useAttachImage`. Two things differ, and both matter: the ticket
 * is drawn on the illustration bucket, so an evening of dish photos cannot eat the scanning quota,
 * and the last step is an **action**, because validating the header means reading the bytes and
 * only an action can.
 */
export function useAttachIllustration(adminToken: string) {
  const generateUploadUrl = useMutation(api.admin.generateUploadUrl)
  const attachIllustration = useAction(api.illustrations.attachIllustration)

  return useCallback(
    async (
      file: File,
      // Named, like `useAttachImage`: the two upload surfaces read the same at their call sites.
      {
        recipeId,
        onPhase,
      }: { recipeId: Id<'recipes'>; onPhase?: (phase: UploadPhase) => void },
    ): Promise<AttachIllustrationResult> => {
      const uploaded = await uploadCompressed(file, {
        adminToken,
        purpose: 'illustration',
        generateUploadUrl,
        onPhase,
      })
      if (!uploaded.ok) return uploaded

      return attachIllustration({
        adminToken,
        ticketId: uploaded.ticketId,
        storageId: uploaded.storageId,
        recipeId,
      })
    },
    [adminToken, attachIllustration, generateUploadUrl],
  )
}
