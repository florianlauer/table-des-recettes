import { describe, expect, it } from 'vitest'
import { pageGesture, rowGesture } from './gestures'
import {
  awaitObservation,
  changeEpoch,
  claim,
  clearOutcomes,
  emptyRegistry,
  isGestureBlocked,
  markOrphaned,
  releaseFocusClaim,
  setProgress,
  settle,
} from './gestureRegistry'
import type { RegistryState } from './gestureRegistry'

const rowA = rowGesture('a', 'save')
const rowB = rowGesture('b', 'save')
const publish = pageGesture('publish')

function start(
  state: RegistryState,
  gesture = rowA,
  over: Partial<Parameters<typeof claim>[1]> = {},
) {
  const attempt = claim(state, {
    gesture,
    pendingLabel: 'Enregistrement…',
    startedAt: 1_000,
    estimateMs: null,
    ...over,
  })
  if (!attempt.claimed) throw new Error('expected the claim to succeed')
  return attempt
}

describe('claim', () => {
  it('refuses a second gesture on the same row in the same tick', () => {
    const first = start(emptyRegistry('e'))
    expect(
      claim(first.state, {
        gesture: rowGesture('a', 'delete'),
        pendingLabel: 'Suppression…',
        startedAt: 1_100,
        estimateMs: null,
      }).claimed,
    ).toBe(false)
  })

  it('lets another row start while the first works', () => {
    const first = start(emptyRegistry('e'))
    expect(start(first.state, rowB).token).toBe(2)
  })

  it('refuses a page gesture while a row works', () => {
    const first = start(emptyRegistry('e'))
    expect(isGestureBlocked(first.state, publish)).toBe(true)
  })

  it('hands out a fresh token per execution', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, {
      ok: true,
      text: 'Fait.',
    })
    expect(start(done, rowA).token).toBe(2)
  })
})

describe('stale tokens', () => {
  it('ignores the progress of a previous execution', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, {
      ok: true,
      text: 'Fait.',
    })
    const second = start(done, rowA)
    const late = setProgress(second.state, rowA, first.token, {
      fraction: 0.9,
      text: 'stale',
    })
    expect(late.runs['["row","a","save"]']?.progress).toBeNull()
  })

  it('ignores the completion of a previous execution', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, {
      ok: true,
      text: 'premier',
    })
    // Starting again perishes the first message on purpose, so what matters is that the late
    // completion neither ends the live run nor publishes a message of its own.
    const second = start(done, rowA)
    const late = settle(second.state, rowA, first.token, {
      ok: true,
      text: 'périmé',
    })
    expect(late.runs['["row","a","save"]']?.token).toBe(second.token)
    expect(late.outcomes['["row","a","save"]']).toBeUndefined()
  })

  it('keeps the run alive when a stale settle arrives', () => {
    const first = start(emptyRegistry('e'))
    const second = settle(first.state, rowA, 99, { ok: true, text: 'nope' })
    expect(second.runs['["row","a","save"]']?.token).toBe(first.token)
  })
})

describe('epoch', () => {
  it('empties everything in flight when the context turns over', () => {
    const first = start(emptyRegistry('token-1'))
    const next = changeEpoch(first.state, 'token-2')
    expect(next.runs).toEqual({})
    expect(next.outcomes).toEqual({})
  })

  it('stops a dead run from locking the new page', () => {
    const first = start(emptyRegistry('token-1'))
    const next = changeEpoch(first.state, 'token-2')
    expect(isGestureBlocked(next, publish)).toBe(false)
  })

  it('does nothing when the epoch has not moved', () => {
    const first = start(emptyRegistry('e'))
    expect(changeEpoch(first.state, 'e')).toBe(first.state)
  })

  it('ignores a completion that belonged to the old epoch', () => {
    const first = start(emptyRegistry('token-1'))
    const next = changeEpoch(first.state, 'token-2')
    expect(
      settle(next, rowA, first.token, { ok: true, text: 'tardif' }).outcomes,
    ).toEqual({})
  })
})

describe('orphaned rows', () => {
  it('keeps the run until it resolves, then republishes its outcome', () => {
    const first = start(emptyRegistry('e'))
    const gone = markOrphaned(first.state, rowA)
    expect(gone.runs['["row","a","save"]']?.orphaned).toBe(true)

    const done = settle(gone, rowA, first.token, { ok: true, text: 'Publiée.' })
    expect(done.outcomes['["row","a","save"]']).toMatchObject({
      orphaned: true,
      result: { text: 'Publiée.' },
    })
  })

  // Regression: ISSUE-002 — a photo posted from /admin/illustrations took its row out of "Sans
  // photo" *after* the gesture had settled, so nothing was left running to mark and the message was
  // rendered nowhere at all. Found by /qa on 2026-08-12.
  // Report: .gstack/qa-reports/qa-report-localhost-3000-2026-08-12.md
  it('marks an outcome that has already settled when its row leaves afterwards', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, {
      ok: true,
      text: 'Fait.',
    })
    expect(done.outcomes['["row","a","save"]']?.orphaned).toBe(false)

    const gone = markOrphaned(done, rowA)
    expect(gone.outcomes['["row","a","save"]']).toMatchObject({
      orphaned: true,
      result: { text: 'Fait.' },
    })
  })

  it('leaves the outcome of a row that is still there alone', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, {
      ok: true,
      text: 'Fait.',
    })
    expect(markOrphaned(done, rowB)).toBe(done)
  })
})

describe('focus claim', () => {
  it('carries the claim of a running gesture onto the outcome that replaces it', () => {
    const first = start(emptyRegistry('e'))
    const gone = markOrphaned(first.state, rowA, { stealsFocus: true })
    expect(gone.runs['["row","a","save"]']?.stealsFocus).toBe(true)

    const done = settle(gone, rowA, first.token, { ok: true, text: 'Publiée.' })
    expect(done.outcomes['["row","a","save"]']?.stealsFocus).toBe(true)
  })

  it('claims nothing when the focus had already moved elsewhere', () => {
    const first = start(emptyRegistry('e'))
    const gone = markOrphaned(first.state, rowA, { stealsFocus: false })
    expect(gone.runs['["row","a","save"]']?.stealsFocus).toBe(false)
  })

  it('names one outcome rather than the whole list', () => {
    const a = start(emptyRegistry('e'), rowA)
    const b = start(a.state, rowB)
    const settledA = settle(b.state, rowA, a.token, { ok: true, text: 'A' })
    const settledB = settle(settledA, rowB, b.token, { ok: true, text: 'B' })

    const gone = markOrphaned(
      markOrphaned(settledB, rowA, { stealsFocus: false }),
      rowB,
      { stealsFocus: true },
    )
    const claiming = Object.values(gone.outcomes).filter(
      (outcome) => outcome.stealsFocus,
    )
    expect(claiming.map((outcome) => outcome.result.text)).toEqual(['B'])
  })

  // The screen re-observes on every render, so releasing has to be final: a claim revived after the
  // message took the focus would drag the cursor back at every tick.
  it('does not revive a claim the republished message has already honoured', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, { ok: true, text: 'A' })
    const gone = markOrphaned(done, rowA, { stealsFocus: true })

    const released = releaseFocusClaim(gone, rowA)
    expect(released.outcomes['["row","a","save"]']?.stealsFocus).toBe(false)
    expect(markOrphaned(released, rowA, { stealsFocus: true })).toBe(released)
  })

  it('ignores a release for a gesture that never claimed anything', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, { ok: true, text: 'A' })
    expect(releaseFocusClaim(done, rowA)).toBe(done)
  })
})

describe('outcome expiry', () => {
  it('drops the previous message of a row when a new gesture starts on it', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, {
      ok: false,
      text: 'Échec.',
    })
    const again = start(done, rowGesture('a', 'delete'))
    expect(again.state.outcomes).toEqual({})
  })

  it('leaves the messages of other rows alone', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, {
      ok: true,
      text: 'Fait.',
    })
    const other = start(done, rowB)
    expect(other.state.outcomes['["row","a","save"]']).toBeDefined()
  })

  it('lets an edit perish the message that described the old value', () => {
    const first = start(emptyRegistry('e'))
    const done = settle(first.state, rowA, first.token, {
      ok: true,
      text: 'Fait.',
    })
    expect(clearOutcomes(done, rowA).outcomes).toEqual({})
  })
})

describe('awaitObservation', () => {
  it('records when the wait for the server state began', () => {
    const first = start(emptyRegistry('e'))
    const waiting = awaitObservation(first.state, rowA, first.token, 4_000)
    expect(waiting.runs['["row","a","save"]']?.settlingSince).toBe(4_000)
  })

  it('ignores a stale token', () => {
    const first = start(emptyRegistry('e'))
    expect(
      awaitObservation(first.state, rowA, 99, 4_000).runs['["row","a","save"]']
        ?.settlingSince,
    ).toBeNull()
  })
})
