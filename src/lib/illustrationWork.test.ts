import { describe, expect, test } from 'vitest'
import { BEAUTIFY_LEASE_MS, illustrationActions } from './illustrationWork'
import type { IllustrationState } from './illustrationWork'

const NOW = 1_000_000

function actions(state: Partial<IllustrationState>) {
  return illustrationActions(
    {
      beautifyStatus: 'idle',
      beautifiedAccepted: false,
      hasOriginal: true,
      hasCandidate: false,
      noPhotoAvailable: false,
      beautifyStartedAt: null,
      ...state,
    },
    { now: NOW, leaseMs: BEAUTIFY_LEASE_MS },
  )
}

describe('transition matrix, as the screen reads it', () => {
  test('offers no generation without a photo', () => {
    expect(actions({ hasOriginal: false }).generate).toBe(false)
  })

  test('offers generation on a photo with no candidate', () => {
    expect(actions({}).generate).toBe(true)
  })

  test('offers generation and deletion on a candidate kept after unpublishing', () => {
    const can = actions({ hasCandidate: true })
    expect(can.generate).toBe(true)
    expect(can.deleteCandidate).toBe(true)
    // Its attempt already reads `accepted`: rewriting it would be a second arbitration.
    expect(can.reject).toBe(false)
  })

  test('refuses everything but unpublishing on a published beautification', () => {
    const can = actions({ hasCandidate: true, beautifiedAccepted: true })
    expect(can.unpublish).toBe(true)
    expect(can.generate).toBe(false)
    expect(can.reject).toBe(false)
    expect(can.deleteCandidate).toBe(false)
    // Replacing or detaching the original while a beautification is published would leave the
    // storefront showing a render of an image that no longer exists.
    expect(can.replace).toBe(false)
    expect(can.detach).toBe(false)
  })

  test('offers nothing but abandonment while generating, and only past the lease', () => {
    const fresh = actions({
      beautifyStatus: 'generating',
      beautifyStartedAt: NOW - 1000,
    })
    expect(fresh.abandon).toBe(false)
    expect(fresh.generate).toBe(false)
    expect(fresh.accept).toBe(false)

    const stalled = actions({
      beautifyStatus: 'generating',
      beautifyStartedAt: NOW - BEAUTIFY_LEASE_MS,
    })
    expect(stalled.abandon).toBe(true)
  })

  test('arbitrates only in review, and refuses a new generation there', () => {
    const can = actions({ beautifyStatus: 'review', hasCandidate: true })
    expect(can.accept).toBe(true)
    expect(can.reject).toBe(true)
    expect(can.generate).toBe(false)
    expect(can.unpublish).toBe(false)
  })

  test('offers a new generation after a failure', () => {
    expect(actions({ beautifyStatus: 'failed' }).generate).toBe(true)
  })
})

describe('the source-has-no-photo flag', () => {
  test('is offered on a recipe with no photo', () => {
    const can = actions({ hasOriginal: false })
    expect(can.markNoPhoto).toBe(true)
    expect(can.unmarkNoPhoto).toBe(false)
  })

  // Marking a photographed recipe is not a claim about the source, it is a contradiction — and the
  // server refuses it, so offering the button would be offering a known error.
  test('is not offered once a photo is attached', () => {
    expect(actions({ hasOriginal: true }).markNoPhoto).toBe(false)
  })

  test('swaps for its undo once set', () => {
    const can = actions({ hasOriginal: false, noPhotoAvailable: true })
    expect(can.markNoPhoto).toBe(false)
    expect(can.unmarkNoPhoto).toBe(true)
    // The way out is either gesture: post the photo, or say the source has one after all.
    expect(can.replace).toBe(true)
  })

  // The flag survives an attachment in the document only as an inert value; the screen must still
  // offer the undo, or a recipe attached then detached would be stuck marked with no way back.
  test('offers the undo even on a photographed recipe that still carries the flag', () => {
    const can = actions({ hasOriginal: true, noPhotoAvailable: true })
    expect(can.unmarkNoPhoto).toBe(true)
    expect(can.markNoPhoto).toBe(false)
  })
})
