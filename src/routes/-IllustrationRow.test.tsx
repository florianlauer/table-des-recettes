import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test, vi } from 'vite-plus/test'
import type { Outcome } from '../lib/gestureRegistry'
import { rowGesture } from '../lib/gestures'
import type { Gestures } from '../lib/useGestures'
import { IllustrationRow } from './-IllustrationRow'
import type { Row } from './-IllustrationRow'

vi.mock('convex/react', () => ({ useMutation: () => async () => ({}) }))
vi.mock('../client/useAttachIllustration', () => ({
  useAttachIllustration: () => async () => ({}),
}))

const row = {
  id: 'recipe-1',
  title: 'Côte de veau',
  type: 'plat',
  status: 'review',
  hasOriginal: false,
  hasCandidate: false,
  originalUrl: null,
  candidateUrl: null,
  originalRendition: null,
  candidateRendition: null,
  thumbnails: false,
  beautifyStatus: 'idle',
  beautifiedAccepted: false,
  noPhotoAvailable: true,
  beautifyError: null,
  beautifyStartedAt: null,
  updatedAt: 0,
} as unknown as Row

/** The outcome of « Aucune dans la source », whose button the mark itself took away. */
const markedOutcome: Outcome = {
  gesture: rowGesture(row.id, 'markNoPhoto'),
  token: 1,
  result: { ok: true, text: 'Fait.' },
  orphaned: false,
  stealsFocus: false,
}

function fakeGestures(): Gestures {
  return {
    run: async () => {},
    confirm: () => {},
    running: () => null,
    outcome: (gesture) =>
      gesture.action === 'markNoPhoto' ? markedOutcome : null,
    blocked: () => false,
    orphanedOutcomes: () => [],
    liveGestures: () => [],
    markOrphaned: () => {},
    releaseFocusClaim: () => {},
    clearOutcomes: () => {},
    holdsFocus: () => false,
  }
}

function render(keepOutcomesInRow: boolean) {
  return renderToStaticMarkup(
    <IllustrationRow
      row={row}
      adminToken="token"
      gestures={fakeGestures()}
      now={0}
      estimateMs={null}
      keepOutcomesInRow={keepOutcomesInRow}
    />,
  )
}

describe('IllustrationRow', () => {
  test('states the photo in words, with the undo right after it', () => {
    const markup = render(false)
    expect(markup).toContain('Photo : <strong>aucune dans la source</strong>')
    expect(markup).toContain('Annuler')
    expect(markup).not.toContain('Aucune dans la source')
  })

  test('prints the outcome of a withdrawn button inside the row when asked to', () => {
    expect(render(true)).toContain('Fait.')
  })

  test('leaves the outcome of a withdrawn button to the page otherwise', () => {
    expect(render(false)).not.toContain('Fait.')
  })
})
