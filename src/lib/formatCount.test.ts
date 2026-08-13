import { describe, expect, it } from 'vitest'
import { formatCount } from './formatCount'

describe('formatCount', () => {
  it('keeps zero and one singular, as French does', () => {
    expect(formatCount(0, 'scan')).toBe('0 scan')
    expect(formatCount(1, 'scan')).toBe('1 scan')
  })

  it('turns plural from two', () => {
    expect(formatCount(2, 'scan')).toBe('2 scans')
    expect(formatCount(12, 'scan')).toBe('12 scans')
  })

  it('takes an irregular plural when adding an s is not enough', () => {
    expect(formatCount(1, 'scan créé', 'scans créés')).toBe('1 scan créé')
    expect(formatCount(3, 'scan créé', 'scans créés')).toBe('3 scans créés')
  })
})
