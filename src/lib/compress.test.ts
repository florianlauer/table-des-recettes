import { afterEach, describe, expect, test, vi } from 'vitest'
import { compressImage, MAX_LONG_EDGE } from './compress'

function png({ width, height }: { width: number; height: number }): Blob {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return new Blob([bytes], { type: 'image/png' })
}

afterEach(() => vi.unstubAllGlobals())

describe('browser image compression', () => {
  test('resizes only the long axis and encodes JPEG', async () => {
    const close = vi.fn()
    const createImageBitmap = vi.fn(async () => ({
      close,
      width: 2000,
      height: 1500,
    }))
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['jpeg'])),
    }
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    vi.stubGlobal('document', { createElement: () => canvas })

    const result = await compressImage(png({ width: 4000, height: 3000 }))
    expect(result).toMatchObject({
      ok: true,
      width: MAX_LONG_EDGE,
      height: 1500,
    })
    expect(createImageBitmap).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({
        imageOrientation: 'from-image',
        resizeWidth: 2000,
      }),
    )
    const bitmapCall = createImageBitmap.mock.calls[0] as unknown as [
      Blob,
      ImageBitmapOptions,
    ]
    expect(bitmapCall[1]).not.toHaveProperty('resizeHeight')
    expect(drawImage).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  test('preserves the oriented bitmap aspect ratio after EXIF rotation', async () => {
    const createImageBitmap = vi.fn(async () => ({
      close: vi.fn(),
      width: 3024,
      height: 4032,
    }))
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['jpeg'])),
    }
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    vi.stubGlobal('document', { createElement: () => canvas })

    const result = await compressImage(png({ width: 4032, height: 3024 }))

    expect(result).toMatchObject({ ok: true, width: 1500, height: 2000 })
    if (result.ok) {
      expect(result.width / result.height).toBeCloseTo(3024 / 4032)
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
        MAX_LONG_EDGE,
      )
    }
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1500, 2000)
  })

  test('refuses unsupported bytes before decoding', async () => {
    const createImageBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const result = await compressImage(new Blob(['not an image']))
    expect(result).toMatchObject({ ok: false, kind: 'unknown_format' })
    expect(createImageBitmap).not.toHaveBeenCalled()
  })
})
