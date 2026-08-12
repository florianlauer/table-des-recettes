import { describe, expect, it } from 'vitest'
import {
  CONFIRMATION_DELAY_MS,
  formatElapsed,
  PROGRESS_CEILING,
  progressView,
} from './gestureProgress'

const at = (
  elapsedMs: number,
  over: Partial<Parameters<typeof progressView>[0]> = {},
) =>
  progressView({
    startedAt: 1_000,
    now: 1_000 + elapsedMs,
    progress: null,
    estimateMs: null,
    floor: 0,
    ...over,
  })

describe('progressView', () => {
  it('draws nothing under the router delay', () => {
    expect(at(399)).toMatchObject({ visible: false, fraction: null, text: '' })
  })

  it('shows the measured fraction and its own wording', () => {
    expect(
      at(1_000, {
        progress: { fraction: 0.25, text: 'Compression 3 / 12 pages…' },
      }),
    ).toMatchObject({
      visible: true,
      fraction: 0.25,
      text: 'Compression 3 / 12 pages…',
      valueText: '25 %',
    })
  })

  it('fills against the journalled duration while inside it', () => {
    expect(at(18_000, { estimateMs: 26_000 })).toMatchObject({
      visible: true,
      text: "18 s / ~26 s d'habitude",
      valueText: "18 s écoulées sur environ 26 s d'habitude",
    })
  })

  it('stops at the ceiling and says so past the estimate', () => {
    expect(at(41_000, { estimateMs: 26_000 })).toMatchObject({
      fraction: PROGRESS_CEILING,
      text: "41 s · plus long que d'habitude",
    })
  })

  it('never promises an end it cannot know', () => {
    expect(at(25_999, { estimateMs: 26_000 }).fraction).toBeLessThanOrEqual(
      PROGRESS_CEILING,
    )
  })

  it('draws no bar at all without an estimate', () => {
    expect(at(41_000)).toMatchObject({
      visible: true,
      fraction: null,
      text: "41 s · pas d'estimation",
    })
  })

  it('says a confirmation is late once the ceiling on settling passes', () => {
    const view = at(5_000, {
      estimateMs: 26_000,
      settlingSince: 1_000 + 5_000 - CONFIRMATION_DELAY_MS,
    })
    expect(view.text).toContain('confirmation retardée')
  })

  it('says nothing about settling before that ceiling', () => {
    const view = at(5_000, { estimateMs: 26_000, settlingSince: 1_000 + 4_000 })
    expect(view.text).not.toContain('confirmation')
  })
})

describe('progressView normalisation', () => {
  it('treats a clock that went backwards as zero elapsed', () => {
    expect(
      progressView({
        startedAt: 10_000,
        now: 1_000,
        progress: null,
        estimateMs: 26_000,
        floor: 0,
      }).visible,
    ).toBe(false)
  })

  it('treats a zero, negative or non-finite estimate as no estimate', () => {
    for (const estimateMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(at(41_000, { estimateMs }).fraction).toBeNull()
  })

  it('bounds a fraction reported outside [0, 1]', () => {
    expect(at(1_000, { progress: { fraction: 4, text: 'x' } }).fraction).toBe(1)
    expect(at(1_000, { progress: { fraction: -1, text: 'x' } }).fraction).toBe(
      0,
    )
    expect(
      at(1_000, { progress: { fraction: Number.NaN, text: 'x' } }).fraction,
    ).toBe(0)
  })

  it('never goes back below the maximum already shown', () => {
    const view = at(1_000, {
      progress: { fraction: 0.1, text: 'x' },
      floor: 0.6,
    })
    expect(view.fraction).toBe(0.6)
    expect(view.nextFloor).toBe(0.6)
  })

  it('reports the new maximum for the caller to keep', () => {
    expect(
      at(13_000, { estimateMs: 26_000, floor: 0.2 }).nextFloor,
    ).toBeCloseTo(0.5)
  })

  it('keeps the floor bounded even when handed nonsense', () => {
    expect(
      at(1_000, { progress: { fraction: 0.5, text: 'x' }, floor: 9 }).fraction,
    ).toBe(1)
  })
})

describe('formatElapsed', () => {
  it('reads in seconds under a minute', () => {
    expect(formatElapsed(18_400)).toBe('18 s')
  })

  it('reads in minutes and seconds beyond', () => {
    expect(formatElapsed(125_000)).toBe('2 min 5 s')
    expect(formatElapsed(120_000)).toBe('2 min')
  })

  it('never reads negative', () => {
    expect(formatElapsed(-5_000)).toBe('0 s')
  })
})
