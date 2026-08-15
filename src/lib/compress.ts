import { IMAGE_HEADER_BYTES, sniffImageHeader } from '../shared/imageHeader'
import type { ImageRefusalKind } from '../shared/imageHeader'

export const MAX_LONG_EDGE = 2000
export const JPEG_QUALITY = 0.8
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

// The header refusals travel through unchanged, so they stay part of the union rather than being
// widened into a bare string the caller can no longer discriminate.
export type CompressionRefusalKind =
  ImageRefusalKind | 'encode_failed' | 'output_too_large'

export type CompressionResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; kind: CompressionRefusalKind; message: string }

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  )
}

export async function compressImage(file: Blob): Promise<CompressionResult> {
  const headerBytes = new Uint8Array(
    await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer(),
  )
  const header = sniffImageHeader({ bytes: headerBytes, fileSize: file.size })
  if (!header.ok) return header

  const longEdge = Math.max(header.width, header.height)
  const scale = Math.min(1, MAX_LONG_EDGE / longEdge)
  const hintedWidth = Math.round(header.width * scale)
  const hintedHeight = Math.round(header.height * scale)
  const resize =
    scale === 1
      ? {}
      : header.width >= header.height
        ? { resizeWidth: hintedWidth }
        : { resizeHeight: hintedHeight }
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
    resizeQuality: 'high',
    ...resize,
  })
  try {
    const orientedLongEdge = Math.max(bitmap.width, bitmap.height)
    const orientedScale = Math.min(1, MAX_LONG_EDGE / orientedLongEdge)
    const width = Math.round(bitmap.width * orientedScale)
    const height = Math.round(bitmap.height * orientedScale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      return {
        ok: false,
        kind: 'encode_failed',
        message: 'Compression impossible',
      }
    }
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvasToBlob(canvas)
    if (!blob) {
      return {
        ok: false,
        kind: 'encode_failed',
        message: 'Compression impossible',
      }
    }
    if (blob.size > MAX_OUTPUT_BYTES) {
      return {
        ok: false,
        kind: 'output_too_large',
        message: 'Image compressée trop volumineuse (4 Mo maximum)',
      }
    }
    return { ok: true, blob, width, height }
  } finally {
    bitmap.close()
  }
}
