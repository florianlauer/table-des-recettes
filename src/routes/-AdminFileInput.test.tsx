import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test } from 'vitest'
import { rowGesture } from '../lib/gestures'
import type { Outcome, Run } from '../lib/gestureRegistry'
import type { Gestures } from '../lib/useGestures'
import { AdminFileInput } from './-AdminFileInput'

const gesture = rowGesture('recipe-1', 'attach')

/** Only what the control reads. The registry itself is covered by `gestureRegistry.test.ts`. */
function fakeGestures({
  running = null,
  outcome = null,
  blocked = false,
}: {
  running?: Run | null
  outcome?: Outcome | null
  blocked?: boolean
} = {}): Gestures {
  return {
    run: async () => {},
    confirm: () => {},
    running: () => running,
    outcome: () => outcome,
    blocked: () => blocked,
    orphanedOutcomes: () => [],
    liveGestures: () => [],
    markOrphaned: () => {},
    releaseFocusClaim: () => {},
    clearOutcomes: () => {},
    holdsFocus: () => false,
  }
}

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
    expect(markup).toMatch(/class="admin-page__file-button">Ajouter une photo</)
    // The browser writes the native button's text in its own UI language, so it must not be visible.
    expect(markup).toMatch(/<input[^>]*class="visually-hidden"[^>]*type="file"/)
  })

  test('renames the control while the upload runs', () => {
    const markup = render({
      gestures: fakeGestures({
        running: {
          gesture,
          token: 7,
          epoch: 'test',
          pendingLabel: 'Envoi…',
          startedAt: 0,
          estimateMs: null,
          progress: null,
          settlingSince: null,
          orphaned: false,
          stealsFocus: false,
        },
      }),
    })
    expect(markup).toMatch(/class="admin-page__file-button">Envoi…</)
    expect(markup).not.toContain('Ajouter une photo')
  })

  test('disables the input itself, which is what the label styling reads', () => {
    expect(render({ disabled: true })).toContain('disabled=""')
    expect(render({ gestures: fakeGestures({ blocked: true }) })).toContain(
      'disabled=""',
    )
  })
})
