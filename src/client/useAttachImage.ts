import { useMutation } from 'convex/react'
import { useCallback } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { uploadCompressed } from './uploadCompressed'
import type { UploadPhase } from '../lib/uploadProgress'

export type AttachResult =
  | { ok: true; scanId: Id<'scans'> }
  | { ok: false; error: string }

/**
 * Shared by the capture surface, which omits `scanId` and therefore creates one scan per file, and
 * by the correction screen, which passes one and adds a page to a scan that already exists.
 */
export function useAttachImage(adminToken: string) {
  const generateUploadUrl = useMutation(api.admin.generateUploadUrl)
  const attachImage = useMutation(api.admin.attachImage)

  return useCallback(
    async (
      file: File,
      // Named rather than positional: the capture surface wants a phase callback and no scan, which
      // as positionals meant writing `attachImage(file, undefined, report)` at the call site.
      {
        scanId,
        onPhase,
      }: {
        scanId?: Id<'scans'>
        onPhase?: (phase: UploadPhase) => void
      } = {},
    ): Promise<AttachResult> => {
      const uploaded = await uploadCompressed(file, {
        adminToken,
        purpose: 'scan',
        generateUploadUrl,
        onPhase,
      })
      if (!uploaded.ok) return uploaded

      return attachImage({
        adminToken,
        ticketId: uploaded.ticketId,
        storageId: uploaded.storageId,
        scanId,
      })
    },
    [adminToken, attachImage, generateUploadUrl],
  )
}
