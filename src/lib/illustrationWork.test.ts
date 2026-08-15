import { describe, expect, test } from 'vitest'
import { availableActions, BEAUTIFY_LEASE_MS } from './illustrationWork'
import type { IllustrationAction, IllustrationState } from './illustrationWork'

const NOW = 1_000_000

function available(state: Partial<IllustrationState>) {
  return availableActions(
    {
      title: 'Clafoutis',
      beautifyStatus: 'idle',
      beautifiedAccepted: false,
      hasOriginal: true,
      hasCandidate: false,
      noPhotoAvailable: false,
      beautifyStartedAt: null,
      awaitingArbitration: false,
      ...state,
    },
    { now: NOW, leaseMs: BEAUTIFY_LEASE_MS },
  )
}

function names(state: Partial<IllustrationState>): IllustrationAction[] {
  return available(state).map((action) => action.name)
}

describe('transition matrix, as the screen reads it', () => {
  test('offers no generation without a photo', () => {
    expect(names({ hasOriginal: false })).not.toContain('generate')
  })

  test('offers generation on a photo with no candidate', () => {
    expect(names({})).toContain('generate')
  })

  test('offers generation and deletion on a candidate kept after unpublishing', () => {
    const shown = names({ hasCandidate: true })
    expect(shown).toContain('generate')
    expect(shown).toContain('deleteCandidate')
    // Its attempt already reads `accepted`: rewriting it would be a second arbitration.
    expect(shown).not.toContain('reject')
  })

  test('refuses everything but unpublishing on a published beautification', () => {
    // Replacing or detaching the original while a beautification is published would leave the
    // storefront showing a render of an image that no longer exists.
    expect(names({ hasCandidate: true, beautifiedAccepted: true })).toEqual([
      'unpublish',
    ])
  })

  test('offers nothing but abandonment while generating, and only past the lease', () => {
    const fresh = names({
      beautifyStatus: 'generating',
      beautifyStartedAt: NOW - 1000,
    })
    expect(fresh).not.toContain('abandon')
    expect(fresh).not.toContain('generate')
    expect(fresh).not.toContain('accept')

    expect(
      names({
        beautifyStatus: 'generating',
        beautifyStartedAt: NOW - BEAUTIFY_LEASE_MS,
      }),
    ).toContain('abandon')
  })

  test('arbitrates only what the server still considers arbitrable', () => {
    const shown = names({
      beautifyStatus: 'review',
      hasCandidate: true,
      awaitingArbitration: true,
    })
    expect(shown).toContain('accept')
    expect(shown).toContain('reject')
    expect(shown).not.toContain('generate')
    expect(shown).not.toContain('unpublish')

    // The divergence this replaces: `review` alone used to be enough, and the two buttons were
    // offered on a generation the guard had already settled — a click for a certain refusal.
    const settled = names({
      beautifyStatus: 'review',
      hasCandidate: true,
      awaitingArbitration: false,
    })
    expect(settled).not.toContain('accept')
    expect(settled).not.toContain('reject')
  })

  test('offers a new generation after a failure', () => {
    expect(names({ beautifyStatus: 'failed' })).toContain('generate')
  })
})

describe('the source-has-no-photo flag', () => {
  test('is offered on a recipe with no photo', () => {
    const shown = names({ hasOriginal: false })
    expect(shown).toContain('markNoPhoto')
    expect(shown).not.toContain('unmarkNoPhoto')
  })

  // Marking a photographed recipe is not a claim about the source, it is a contradiction — and the
  // server refuses it, so offering the button would be offering a known error.
  test('is not offered once a photo is attached', () => {
    expect(names({ hasOriginal: true })).not.toContain('markNoPhoto')
  })

  test('swaps for its undo once set', () => {
    const shown = names({ hasOriginal: false, noPhotoAvailable: true })
    expect(shown).not.toContain('markNoPhoto')
    expect(shown).toContain('unmarkNoPhoto')
    // The way out is either gesture: post the photo, or say the source has one after all.
    expect(shown).toContain('upload')
  })

  // The flag survives an attachment in the document only as an inert value; the screen must still
  // offer the undo, or a recipe attached then detached would be stuck marked with no way back.
  test('offers the undo even on a photographed recipe that still carries the flag', () => {
    const shown = names({ hasOriginal: true, noPhotoAvailable: true })
    expect(shown).toContain('unmarkNoPhoto')
    expect(shown).not.toContain('markNoPhoto')
  })
})

/** What the old shape could not assert: an action is a whole gesture, words included. */
describe('what an available action says', () => {
  test('every gesture that destroys a paid render asks first, and names the row', () => {
    const destructive = ['reject', 'deleteCandidate', 'detach']
    const seen = available({
      hasOriginal: true,
      hasCandidate: true,
      beautifyStatus: 'review',
      awaitingArbitration: true,
    }).concat(available({ hasCandidate: true }))
    const asked = [
      ...new Map(
        seen
          .filter((action) => destructive.includes(action.name))
          .map((action) => [action.name, action]),
      ).values(),
    ]
    expect(asked.map((action) => action.name).sort()).toEqual([
      'deleteCandidate',
      'detach',
      'reject',
    ])
    for (const action of asked) expect(action.confirm).toContain('Clafoutis')

    // The two flag gestures are reversible with the opposite button: asking would be noise.
    for (const action of available({
      hasOriginal: false,
      noPhotoAvailable: true,
    }))
      if (action.name.endsWith('NoPhoto'))
        expect(action.confirm).toBeUndefined()
  })

  test('a row with no title is still named in its confirmations', () => {
    const [detach] = available({ title: '' }).filter(
      (action) => action.name === 'detach',
    )
    expect(detach?.confirm).toContain('sans titre')
  })

  test('the generation renames itself once a candidate exists, and is the only settled wait', () => {
    expect(
      available({}).find((action) => action.name === 'generate'),
    ).toMatchObject({ label: 'Embellir', settle: true })
    expect(
      available({ hasCandidate: true }).find(
        (action) => action.name === 'generate',
      )?.label,
    ).toBe('Régénérer')
    expect(
      available({ hasCandidate: true, beautifyStatus: 'review' }).filter(
        (action) => action.settle,
      ),
    ).toEqual([])
  })

  test('the upload names what it will do to the photo already there', () => {
    expect(available({ hasOriginal: false })[0]).toMatchObject({
      name: 'upload',
      control: 'file',
      label: 'Ajouter une photo',
    })
    expect(available({ hasOriginal: true })[0]).toMatchObject({
      label: 'Remplacer la photo',
    })
  })
})
