import { renderToStaticMarkup } from 'react-dom/server.browser'
import { getFunctionName } from 'convex/server'
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import type { FunctionReference } from 'convex/server'
import type { Id } from '../../convex/_generated/dataModel'
import { fakeGestures } from '../lib/gestures.fixture'
import { IllustrationRow } from './-IllustrationRow'
import type { Row } from './-IllustrationRow'
import { AdminFileInput } from './-AdminFileInput'

const { attachIllustration, requestBeautify } = vi.hoisted(() => ({
  attachIllustration: vi.fn(),
  requestBeautify: vi.fn(),
}))

vi.mock('convex/react', () => ({
  useMutation: (mutation: FunctionReference<'mutation'>) =>
    getFunctionName(mutation) === 'illustrations:requestBeautify'
      ? requestBeautify
      : async () => ({ ok: true }),
}))
vi.mock('../client/useAttachIllustration', () => ({
  useAttachIllustration: () => attachIllustration,
}))
vi.mock('./-AdminFileInput', async (importOriginal) => {
  const original = await importOriginal<{
    AdminFileInput: typeof AdminFileInput
  }>()
  return { ...original, AdminFileInput: vi.fn(original.AdminFileInput) }
})

beforeEach(() => {
  vi.clearAllMocks()
  attachIllustration.mockReset().mockResolvedValue({ ok: true })
  requestBeautify.mockReset().mockResolvedValue({ ok: true })
})

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

  test('starts beautification only after the photo is attached', async () => {
    render()
    const { onFiles } = vi.mocked(AdminFileInput).mock.calls[0]![0]
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    let finishUpload!: (result: { ok: true }) => void
    attachIllustration.mockReturnValue(
      new Promise((resolve) => {
        finishUpload = resolve
      }),
    )

    const result = onFiles([file], vi.fn())
    expect(requestBeautify).not.toHaveBeenCalled()
    finishUpload({ ok: true })

    await expect(result).resolves.toEqual({
      ok: true,
      text: 'Photo enregistrée. Embellissement lancé.',
    })
    expect(attachIllustration).toHaveBeenCalledWith(file, {
      recipeId: row.id,
      onPhase: expect.any(Function),
    })
    expect(requestBeautify).toHaveBeenCalledExactlyOnceWith({
      adminToken: 'token',
      recipeId: row.id,
    })
  })

  test('does not start beautification when the upload fails', async () => {
    render()
    const { onFiles } = vi.mocked(AdminFileInput).mock.calls[0]![0]
    attachIllustration.mockResolvedValue({ ok: false, error: 'Envoi refusé' })

    await expect(
      onFiles([new File([], 'photo.jpg')], vi.fn()),
    ).resolves.toEqual({ ok: false, text: 'Envoi refusé' })
    expect(requestBeautify).not.toHaveBeenCalled()
  })

  test.each(['refused', 'thrown'])(
    'reports a saved photo when generation is %s',
    async (failure) => {
      render()
      const { onFiles } = vi.mocked(AdminFileInput).mock.calls[0]![0]
      if (failure === 'refused')
        requestBeautify.mockResolvedValue({
          ok: false,
          error: 'Limite atteinte',
        })
      else requestBeautify.mockRejectedValue(new Error('Limite atteinte'))

      await expect(
        onFiles([new File([], 'photo.jpg')], vi.fn()),
      ).resolves.toEqual({
        ok: false,
        text: 'Photo enregistrée. Embellissement non lancé : Limite atteinte',
      })
    },
  )
})
