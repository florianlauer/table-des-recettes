import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getClock,
  getServerTick,
  getTick,
  isTicking,
  resetClockForTests,
  subscribeToTick,
  TICK_MS,
} from './clock'

beforeEach(() => {
  vi.useFakeTimers()
  resetClockForTests()
})

afterEach(() => {
  resetClockForTests()
  vi.useRealTimers()
})

describe('shared tick', () => {
  it('starts ticking on the first subscription only', () => {
    expect(isTicking()).toBe(false)
    const first = subscribeToTick(() => undefined)
    const second = subscribeToTick(() => undefined)
    expect(isTicking()).toBe(true)
    first()
    expect(isTicking()).toBe(true)
    second()
    expect(isTicking()).toBe(false)
  })

  it('notifies its subscribers on each tick', () => {
    const notified = vi.fn()
    subscribeToTick(notified)
    vi.advanceTimersByTime(TICK_MS * 3)
    expect(notified).toHaveBeenCalledTimes(3)
  })

  it('holds the same snapshot between two ticks, so a render cannot loop', () => {
    subscribeToTick(() => undefined)
    const before = getTick()
    expect(getTick()).toBe(before)
    vi.advanceTimersByTime(TICK_MS)
    expect(getTick()).toBe(before + 1)
  })

  it('reads the clock once per tick, so every bar agrees on now', () => {
    vi.setSystemTime(new Date(1_000_000))
    subscribeToTick(() => undefined)
    expect(getClock()).toBe(1_000_000)

    // Time moving is not enough: the stored value only changes when the interval fires.
    vi.setSystemTime(new Date(1_000_100))
    expect(getClock()).toBe(1_000_000)

    vi.advanceTimersByTime(TICK_MS)
    expect(getClock()).toBe(1_000_100 + TICK_MS)
  })

  it('stops the interval once the last bar leaves', () => {
    const notified = vi.fn()
    const unsubscribe = subscribeToTick(notified)
    unsubscribe()
    vi.advanceTimersByTime(TICK_MS * 10)
    expect(notified).not.toHaveBeenCalled()
    expect(isTicking()).toBe(false)
  })

  it('keeps a constant snapshot on the server', () => {
    expect(getServerTick()).toBe(0)
  })
})
