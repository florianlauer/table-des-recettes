import { describe, expect, test } from 'vitest'
import { stageOf } from './illustrationStage'

describe('stageOf', () => {
  test('no photo and no flag is work still to shoot', () => {
    expect(
      stageOf({
        imageStorageId: undefined,
        beautifiedAccepted: false,
        noPhotoAvailable: false,
      }),
    ).toBe('missing')
  })

  test('no photo and the flag set leaves the work queue', () => {
    expect(
      stageOf({
        imageStorageId: undefined,
        beautifiedAccepted: false,
        noPhotoAvailable: true,
      }),
    ).toBe('source-has-none')
  })

  test('an original without an accepted beautification is the main flow', () => {
    expect(
      stageOf({
        imageStorageId: 'blob',
        beautifiedAccepted: false,
        noPhotoAvailable: false,
      }),
    ).toBe('to-beautify')
  })

  test('an accepted beautification is finished', () => {
    expect(
      stageOf({
        imageStorageId: 'blob',
        beautifiedAccepted: true,
        noPhotoAvailable: false,
      }),
    ).toBe('done')
  })

  // The flag only speaks when there is no photo: attaching one makes it inert rather than
  // contradictory, which is what lets a single key carry both halves of the answer.
  test('the flag is ignored once a photo is attached', () => {
    expect(
      stageOf({
        imageStorageId: 'blob',
        beautifiedAccepted: false,
        noPhotoAvailable: true,
      }),
    ).toBe('to-beautify')
    expect(
      stageOf({
        imageStorageId: 'blob',
        beautifiedAccepted: true,
        noPhotoAvailable: true,
      }),
    ).toBe('done')
  })

  // `beautifiedAccepted` cannot be true without a photo in practice — `detachIllustration` refuses
  // while one is published — but the function must still answer, and it must not answer 'done'.
  test('an accepted flag without a photo is still counted as missing', () => {
    expect(
      stageOf({
        imageStorageId: undefined,
        beautifiedAccepted: true,
        noPhotoAvailable: false,
      }),
    ).toBe('missing')
    expect(
      stageOf({
        imageStorageId: undefined,
        beautifiedAccepted: true,
        noPhotoAvailable: true,
      }),
    ).toBe('source-has-none')
  })
})
