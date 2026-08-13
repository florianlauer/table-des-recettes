import { describe, expect, it } from 'vitest'
import { gestureNoteMark, gestureNoteReading } from './gestureNote'

describe('gestureNoteMark', () => {
  it('separates a success from a failure by a glyph, not by colour alone', () => {
    expect(gestureNoteMark({ ok: true, text: 'Photo publiée.' })).toBe('✓')
    expect(gestureNoteMark({ ok: false, text: 'Aucun candidat.' })).toBe('✗')
  })
})

describe('gestureNoteReading', () => {
  it('gives assistive technology the word the glyph stands for', () => {
    expect(gestureNoteReading({ ok: true, text: 'Photo publiée.' })).toBe(
      'Succès :',
    )
    expect(gestureNoteReading({ ok: false, text: 'Aucun candidat.' })).toBe(
      'Échec :',
    )
  })
})
