import { renderToStaticMarkup } from 'react-dom/server.browser'
import { describe, expect, test } from 'vitest'
import { rowGesture } from '../lib/gestures'
import type { Outcome, Run } from '../lib/gestureRegistry'
import type { Gestures } from '../lib/useGestures'
import { AdminButton } from './-AdminButton'

const gesture = rowGesture('recipe-1', 'generate')

/** Only what the button reads. The registry itself is covered by `gestureRegistry.test.ts`. */
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

function runningSince(elapsedMs: number, estimateMs: number | null): Run {
  return {
    gesture,
    token: 7,
    epoch: 'test',
    pendingLabel: 'Embellissement…',
    startedAt: Date.now() - elapsedMs,
    estimateMs,
    progress: null,
    settlingSince: null,
    orphaned: false,
    stealsFocus: false,
  }
}

describe('AdminButton', () => {
  test('renders both labels so the width never jumps, hiding the inactive one', () => {
    const markup = renderToStaticMarkup(
      <AdminButton
        gestures={fakeGestures()}
        gesture={gesture}
        label="Embellir"
        pendingLabel="Embellissement…"
        run={async () => ({ ok: true, text: 'Fait.' })}
      />,
    )
    expect(markup).toContain('Embellir')
    expect(markup).toContain('Embellissement…')
    // At rest the pending label is the ghost; the label being read is not.
    expect(markup).toMatch(/class="btn__label"[^>]*>Embellir</)
    expect(markup).toMatch(
      /class="btn__label btn__label--ghost">Embellissement…</,
    )
  })

  test('ghosts the resting label instead while the gesture runs', () => {
    const markup = renderToStaticMarkup(
      <AdminButton
        gestures={fakeGestures({ running: runningSince(0, null) })}
        gesture={gesture}
        label="Embellir"
        pendingLabel="Embellissement…"
        run={async () => ({ ok: true, text: 'Fait.' })}
      />,
    )
    expect(markup).toMatch(
      /class="btn__label btn__label--ghost"[^>]*>Embellir</,
    )
    expect(markup).toMatch(/class="btn__label">Embellissement…</)
  })

  test('names the reason it is inert, and points the button at it', () => {
    const markup = renderToStaticMarkup(
      <AdminButton
        gestures={fakeGestures()}
        gesture={gesture}
        label="Supprimer"
        pendingLabel="Suppression…"
        disabled
        blockedReason="Dépublie la recette avant de la supprimer."
        run={async () => ({ ok: true, text: 'Fait.' })}
      />,
    )
    const described = markup.match(/aria-describedby="([^"]+)"/)
    expect(described).not.toBeNull()
    expect(markup).toContain(
      `id="${described?.[1]}">Dépublie la recette avant de la supprimer.`,
    )
  })

  test('says nothing about blocking when the control is live', () => {
    const markup = renderToStaticMarkup(
      <AdminButton
        gestures={fakeGestures()}
        gesture={gesture}
        label="Supprimer"
        pendingLabel="Suppression…"
        blockedReason="Dépublie la recette avant de la supprimer."
        run={async () => ({ ok: true, text: 'Fait.' })}
      />,
    )
    expect(markup).not.toContain('aria-describedby')
    expect(markup).not.toContain('Dépublie la recette')
  })

  test('names the bar by the gesture and by its row, never anonymously', () => {
    const markup = renderToStaticMarkup(
      <AdminButton
        gestures={fakeGestures({ running: runningSince(20_000, 26_000) })}
        gesture={gesture}
        label="Embellir"
        pendingLabel="Embellissement…"
        titleId="row-title"
        run={async () => ({ ok: true, text: 'Fait.' })}
      />,
    )
    const labelled = markup.match(/aria-labelledby="([^" ]+) row-title"/)
    expect(labelled).not.toBeNull()
    // The first id is the button's own label — the bar reads "Embellissement, <recipe>".
    expect(markup).toContain(`id="${labelled?.[1]}"`)
    expect(markup).toContain('role="progressbar"')
  })

  test('publishes the result keyed by its execution, and only its own', () => {
    const markup = renderToStaticMarkup(
      <AdminButton
        gestures={fakeGestures({
          outcome: {
            gesture,
            token: 3,
            result: { ok: true, text: 'Embellissement lancé.' },
            orphaned: false,
            stealsFocus: false,
          },
        })}
        gesture={gesture}
        label="Embellir"
        pendingLabel="Embellissement…"
        run={async () => ({ ok: true, text: 'Fait.' })}
      />,
    )
    expect(markup).toContain('role="status"')
    expect(markup).toContain('Embellissement lancé.')
  })

  test('leaves an orphaned result to the section that outlived the row', () => {
    const markup = renderToStaticMarkup(
      <AdminButton
        gestures={fakeGestures({
          outcome: {
            gesture,
            token: 3,
            result: { ok: true, text: 'Recette supprimée.' },
            orphaned: true,
            stealsFocus: false,
          },
        })}
        gesture={gesture}
        label="Supprimer"
        pendingLabel="Suppression…"
        run={async () => ({ ok: true, text: 'Fait.' })}
      />,
    )
    expect(markup).not.toContain('Recette supprimée.')
  })
})
