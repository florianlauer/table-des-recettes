import { describe, expect, it } from 'vitest'
import { formatScanLabel, scanStatusLabel } from './scanLabel'

describe('formatScanLabel', () => {
  it('names a scan by when it was taken', () => {
    // Built from local parts on purpose: the label reads in local time, and so does the test.
    const createdAt = new Date(2026, 7, 12, 14, 3).getTime()
    expect(formatScanLabel(createdAt)).toBe('Scan du 12 août à 14 h 03')
  })

  it('pads the minutes', () => {
    expect(formatScanLabel(new Date(2026, 0, 1, 9, 5).getTime())).toBe(
      'Scan du 1 janvier à 9 h 05',
    )
  })
})

describe('scanStatusLabel', () => {
  it('says the state in words', () => {
    expect(scanStatusLabel('extracting')).toBe('en cours')
    expect(scanStatusLabel('failed')).toBe('en échec')
  })

  it('passes an unknown state through rather than hiding it', () => {
    expect(scanStatusLabel('surprise')).toBe('surprise')
  })
})
