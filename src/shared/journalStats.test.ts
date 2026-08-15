import { describe, expect, it } from 'vitest'
import { nonEmpty } from './journalStats'

describe('nonEmpty', () => {
  it('refuses an empty list rather than handing back a tuple type that lies', () => {
    expect(nonEmpty([])).toBeNull()
  })

  it('hands the same list back, now typed as holding at least one row', () => {
    const rows = [1, 2, 3]
    const checked = nonEmpty(rows)
    expect(checked).toBe(rows)
    // The point of the type: row zero reads without a cast and without a runtime check.
    if (checked) expect(checked[0]).toBe(1)
  })
})
