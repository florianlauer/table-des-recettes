// `btoa` and `atob` take and return binary strings, so both directions need a chunked walk. Kept in
// one place because the request encodes bytes and the response decodes them, and two hand-written
// loops on opposite sides of a call is how an off-by-one becomes a corrupt image.

// 32 kB at a time: `String.fromCharCode` is variadic, and spreading a whole image blows the stack.
const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK)))
  }
  return btoa(chunks.join(''))
}

// The `ArrayBuffer` argument is not decoration: a bare `Uint8Array` is backed by `ArrayBufferLike`,
// which `BlobPart` refuses because it could be shared memory. The buffer minted here never is.
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}
