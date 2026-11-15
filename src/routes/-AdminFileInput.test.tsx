import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test } from 'vite-plus/test'
import { rowGesture } from '../lib/gestures'
import { fakeGestures } from '../lib/gestures.fixture'
import { AdminFileInput } from './-AdminFileInput'

const gesture = rowGesture('recipe-1', 'attach')

function render(props: Partial<Parameters<typeof AdminFileInput>[0]> = {}) {
  return renderToStaticMarkup(
    <AdminFileInput
      gestures={fakeGestures()}
      gesture={gesture}
      label="Ajouter une photo"
      pendingLabel="Envoi…"
      onFiles={async () => ({ ok: true, text: 'Fait.' })}
      {...props}
    />,
  )
}

describe('AdminFileInput', () => {
  test('shows the imperative as the control and hides the native button', () => {
    const markup = render()
    expect(markup).toMatch(
      /class="btn btn--secondary">.*?class="btn__label">Ajouter une photo</,
    )
    // The browser writes the native button's text in its own UI language, so it must not be visible.
    expect(markup).toMatch(/<input[^>]*class="visually-hidden"[^>]*type="file"/)
  })

  test('swaps to the pending label without changing width', () => {
    const markup = render({
      gestures: fakeGestures({
        running: {
          gesture,
          token: 7,
          epoch: 'test',
          pendingLabel: 'Envoi…',
          subject: null,
          startedAt: 0,
          estimateMs: null,
          progress: null,
          settlingSince: null,
          orphaned: false,
          stealsFocus: false,
        },
      }),
    })
    // Both labels stay in the cell, so « Envoi… » keeps the width of « Ajouter une photo ».
    expect(markup).toMatch(
      /class="btn__label btn__label--ghost">Ajouter une photo</,
    )
    expect(markup).toMatch(/class="btn__label">Envoi…</)
  })

  test('disables the input itself and marks its face inert', () => {
    for (const markup of [
      render({ disabled: true }),
      render({ gestures: fakeGestures({ blocked: true }) }),
    ]) {
      expect(markup).toContain('disabled=""')
      expect(markup).toContain('data-inert="true"')
    }
  })
})
