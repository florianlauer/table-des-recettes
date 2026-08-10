export const MAX_INPUT_BYTES = 25 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 50_000_000
export const IMAGE_HEADER_BYTES = 64 * 1024

export type ImageFormat = 'jpeg' | 'png'
export type ImageRefusalKind =
  | 'too_large'
  | 'heic'
  | 'webp'
  | 'unknown_format'
  | 'invalid_header'
  | 'too_many_pixels'

export type ImageHeaderResult =
  | { ok: true; format: ImageFormat; width: number; height: number }
  | { ok: false; kind: ImageRefusalKind; message: string }

const refusal = (
  kind: ImageRefusalKind,
  message: string,
): ImageHeaderResult => ({ ok: false, kind, message })

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function dimensionsResult({
  format,
  width,
  height,
}: {
  format: ImageFormat
  width: number
  height: number
}): ImageHeaderResult {
  if (width <= 0 || height <= 0) {
    return refusal('invalid_header', 'En-tête d’image invalide ou tronqué')
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return refusal('too_many_pixels', 'Image trop grande (50 Mpx maximum)')
  }
  return { ok: true, format, width, height }
}

function sniffJpeg(bytes: Uint8Array): ImageHeaderResult {
  let offset = 2
  while (offset < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined) break
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue
    if (marker === 0xda) break
    if (offset + 2 > bytes.length) break
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.length) break
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame) {
      if (length < 7) break
      return dimensionsResult({
        format: 'jpeg',
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      })
    }
    offset += length
  }
  return refusal('invalid_header', 'En-tête JPEG invalide ou tronqué')
}

export function sniffImageHeader({
  bytes,
  fileSize,
}: {
  bytes: Uint8Array
  fileSize: number
}): ImageHeaderResult {
  if (fileSize > MAX_INPUT_BYTES) {
    return refusal('too_large', 'Image trop volumineuse (25 Mo maximum)')
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 4, 4) === 'ftyp' &&
    ['heic', 'heix', 'mif1', 'msf1'].includes(ascii(bytes, 8, 4))
  ) {
    return refusal('heic', 'HEIC non pris en charge, convertis en JPEG')
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WEBP'
  ) {
    return refusal('webp', 'WebP non pris en charge, convertis en JPEG')
  }
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    ascii(bytes, 12, 4) === 'IHDR'
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return dimensionsResult({
      format: 'png',
      width: view.getUint32(16),
      height: view.getUint32(20),
    })
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return sniffJpeg(bytes)
  }
  return refusal('unknown_format', 'Format d’image non pris en charge')
}
