import { describe, expect, test } from 'vite-plus/test'
import { bulkDuplicateConfirm, duplicateNote } from './duplicateMessages'

describe('duplicate note', () => {
  test('says a published twin is already on the storefront', () => {
    expect(duplicateNote({ title: 'Tarte Tatin', status: 'published' })).toBe(
      '« Tarte Tatin » est déjà en ligne sous ce titre.',
    )
  })

  // Two very different situations behind one flag: a second copy online, or a page scanned twice.
  // Reading « déjà en ligne » on a draft would send the operator looking for a page that has none.
  test('says a twin in review is only a second draft', () => {
    expect(duplicateNote({ title: 'Tarte Tatin', status: 'review' })).toBe(
      '« Tarte Tatin » porte déjà ce titre et attend en relecture.',
    )
  })
})

describe('the bulk confirmation', () => {
  test('names every duplicate of the scan before publishing it whole', () => {
    expect(bulkDuplicateConfirm(['Tarte Tatin', 'Clafoutis'])).toBe(
      '2 recettes de ce scan portent un titre déjà scanné : Tarte Tatin · Clafoutis. Tout publier quand même ?',
    )
  })

  test('keeps the singular for one', () => {
    expect(bulkDuplicateConfirm(['Tarte Tatin'])).toBe(
      'Une recette de ce scan porte un titre déjà scanné : Tarte Tatin. Tout publier quand même ?',
    )
  })

  // A scan may carry fifty recipes. The browser truncates a dialog long before that, and it would
  // cut the list without saying it had — so the count is stated and the tail is named as a number.
  test('cuts the list rather than letting the browser cut it', () => {
    const titles = Array.from({ length: 12 }, (_, index) => `Recette ${index}`)
    const message = bulkDuplicateConfirm(titles)
    expect(message).toContain('12 recettes de ce scan')
    expect(message).toContain('Recette 7 — et 4 de plus.')
    expect(message).not.toContain('Recette 8')
  })
})
