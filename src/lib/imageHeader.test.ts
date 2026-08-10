import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { MAX_INPUT_BYTES, sniffImageHeader } from './imageHeader'

function png({ width, height }: { width: number; height: number }): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

describe('image header sniffing', () => {
  test('reads all eight real JPEG fixture dimensions', () => {
    for (const page of 'abcdefgh') {
      const bytes = readFileSync(resolve(`spike/fixtures/pages/${page}.jpg`))
      const result = sniffImageHeader({ bytes, fileSize: bytes.length })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.format).toBe('jpeg')
    }
  })

  test('reads PNG dimensions and enforces byte and pixel ceilings', () => {
    expect(
      sniffImageHeader({
        bytes: png({ width: 640, height: 480 }),
        fileSize: 24,
      }),
    ).toEqual({
      ok: true,
      format: 'png',
      width: 640,
      height: 480,
    })
    expect(
      sniffImageHeader({
        bytes: png({ width: 8000, height: 7000 }),
        fileSize: 24,
      }),
    ).toMatchObject({ ok: false, kind: 'too_many_pixels' })
    expect(
      sniffImageHeader({
        bytes: png({ width: 1, height: 1 }),
        fileSize: MAX_INPUT_BYTES + 1,
      }),
    ).toMatchObject({ ok: false, kind: 'too_large' })
  })

  test.each([
    [
      new Uint8Array([
        0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
      ]),
      'heic',
    ],
    [
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]),
      'webp',
    ],
    [new Uint8Array([1, 2, 3]), 'unknown_format'],
  ])('returns a named refusal', (bytes, kind) => {
    expect(sniffImageHeader({ bytes, fileSize: bytes.length })).toMatchObject({
      ok: false,
      kind,
    })
  })
})
