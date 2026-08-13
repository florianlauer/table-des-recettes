import { describe, expect, it } from 'vitest'
import { formatMs, formatRate, formatUsd } from './formatNumber'

describe('formatUsd', () => {
  it('uses the French decimal comma and keeps four digits', () => {
    expect(formatUsd(0.0123)).toBe('0,0123 USD')
    expect(formatUsd(0)).toBe('0,0000 USD')
  })
})

describe('formatMs', () => {
  it('rounds and groups the French way', () => {
    expect(formatMs(342.6)).toBe('343 ms')
    // The group separator is a no-break space, of a width ICU may spell either way.
    expect(formatMs(12_000)).toMatch(/^12\s000 ms$/u)
  })
})

describe('formatRate', () => {
  it('drops the decimals of a plain rate', () => {
    expect(formatRate(0.12)).toBe('12 %')
    expect(formatRate(0)).toBe('0 %')
  })

  it('keeps one decimal below a percent, so a real failure is not rounded to zero', () => {
    expect(formatRate(0.004)).toBe('0,4 %')
  })
})
