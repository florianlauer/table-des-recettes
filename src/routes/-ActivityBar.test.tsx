import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test } from 'vite-plus/test'
import { rowGesture } from '../lib/gestures'
import { fakeGestures } from '../lib/gestures.fixture'
import { AdminActivity } from './-ActivityBar'

const gesture = rowGesture('recipe-1', 'publish')

function render(gestures = fakeGestures()) {
  return renderToStaticMarkup(
    <AdminActivity gestures={gestures}>
      <p>page</p>
    </AdminActivity>,
  )
}

describe('AdminActivity', () => {
  test('draws no bar while nothing runs', () => {
    const markup = render()
    expect(markup).not.toContain('class="activity"')
    expect(markup).toContain('<p>page</p>')
  })

  test('names what runs and on what, with its progress', () => {
    const markup = render(
      fakeGestures({
        running: {
          gesture,
          token: 4,
          epoch: 'test',
          pendingLabel: 'Publication…',
          subject: 'Gratin dauphinois',
          startedAt: Date.now() - 20_000,
          estimateMs: 26_000,
          progress: null,
          settlingSince: null,
          orphaned: false,
          stealsFocus: false,
        },
      }),
    )
    expect(markup).toMatch(/<b>Publication…<\/b>.*· Gratin dauphinois/)
    const labelled = /aria-labelledby="([^"]+)"/.exec(markup)?.[1]
    expect(markup).toContain(`id="${labelled}"`)
    expect(markup).toContain('role="progressbar"')
  })

  test('publishes a result as a status line the operator can close', () => {
    const markup = render(
      fakeGestures({
        outcome: {
          gesture,
          token: 3,
          result: { ok: false, text: 'Échec : la recette est publiée.' },
          subject: 'Gratin dauphinois',
          orphaned: true,
          stealsFocus: false,
        },
      }),
    )
    expect(markup).toContain('role="status"')
    expect(markup).toContain('data-ok="false"')
    expect(markup).toContain('Échec : la recette est publiée.')
    expect(markup).toContain('Fermer ce message')
  })
})
