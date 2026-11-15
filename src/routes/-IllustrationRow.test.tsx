import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test, vi } from 'vite-plus/test'
import type { Id } from '../../convex/_generated/dataModel'
import { fakeGestures } from '../lib/gestures.fixture'
import { IllustrationRow } from './-IllustrationRow'
import type { Row } from './-IllustrationRow'

vi.mock('convex/react', () => ({ useMutation: () => async () => ({}) }))
vi.mock('../client/useAttachIllustration', () => ({
  useAttachIllustration: () => async () => ({}),
}))

const row: Row = {
  id: 'recipe-1' as Id<'recipes'>,
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
  noPhotoAvailable: false,
  beautifyError: null,
  beautifyStartedAt: null,
  updatedAt: 0,
}

function render(overrides: Partial<Row> = {}) {
  return renderToStaticMarkup(
    <IllustrationRow
      row={{ ...row, ...overrides }}
      adminToken="token"
      gestures={fakeGestures()}
      now={0}
      estimateMs={null}
    />,
  )
}

describe('IllustrationRow', () => {
  test('states a missing photo in words, the toggle right under it', () => {
    const markup = render()
    expect(markup).toContain('Photo : <strong>aucune pour l’instant</strong>')
    expect(markup).toMatch(/Photo :.*Aucune dans la source.*Ajouter une photo/)
  })

  test('describes « Annuler » by the line it cancels', () => {
    const markup = render({ noPhotoAvailable: true })
    expect(markup).toContain('Photo : <strong>aucune dans la source</strong>')
    const lineId = /<p id="([^"]+)">Photo :/.exec(markup)?.[1]
    expect(lineId).toBeDefined()
    expect(markup).toMatch(
      new RegExp(`aria-describedby="${lineId}"[^>]*>.*?>Annuler<`),
    )
  })

  test('tells the four kinds of control apart before they are read', () => {
    const judged = render({ hasOriginal: true, hasCandidate: true })
    expect(judged).toMatch(/class="btn btn--secondary"[^>]*>.*?Régénérer/)
    expect(judged).toMatch(/class="btn btn--danger"[^>]*>.*?Retirer la photo/)
    expect(render()).toMatch(
      /class="btn btn--quiet"[^>]*>.*?Aucune dans la source/,
    )
  })
})
