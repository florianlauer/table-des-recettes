import { describe, expect, test } from 'vitest'
import { pickDisplayImage } from './displayImage'

describe('pickDisplayImage', () => {
  test('an accepted beautified version wins', () => {
    expect(
      pickDisplayImage({
        imageStorageId: 'orig',
        beautifiedStorageId: 'beau',
        beautifiedAccepted: true,
      }),
    ).toEqual({ kind: 'beautified', storageId: 'beau' })
  })

  test('an unaccepted candidate is never displayed', () => {
    expect(
      pickDisplayImage({
        imageStorageId: 'orig',
        beautifiedStorageId: 'beau',
        beautifiedAccepted: false,
      }),
    ).toEqual({ kind: 'original', storageId: 'orig' })
  })

  test('original only', () => {
    expect(
      pickDisplayImage({ imageStorageId: 'orig', beautifiedAccepted: false }),
    ).toEqual({
      kind: 'original',
      storageId: 'orig',
    })
  })

  test('no image at all', () => {
    expect(pickDisplayImage({ beautifiedAccepted: false })).toBeNull()
  })

  test('an accepted candidate with no file falls back to the original', () => {
    expect(
      pickDisplayImage({ imageStorageId: 'orig', beautifiedAccepted: true }),
    ).toEqual({
      kind: 'original',
      storageId: 'orig',
    })
  })
})
