import { describe, expect, it } from 'vitest'
import { draftChange, urlChange } from './searchDraft'

describe('urlChange', () => {
  it('ignores the page own navigation echoing back', () => {
    expect(urlChange({ q: 'courgette', pushed: 'courgette' })).toEqual({
      adopt: false,
    })
  })

  it('adopts a change the page did not push', () => {
    expect(urlChange({ q: 'courge', pushed: 'courgette' })).toEqual({
      adopt: true,
      draft: 'courge',
    })
  })

  it('reads a missing q as an empty field', () => {
    expect(urlChange({ q: undefined, pushed: '' })).toEqual({ adopt: false })
    expect(urlChange({ q: undefined, pushed: 'courgette' })).toEqual({
      adopt: true,
      draft: '',
    })
  })
})

describe('draftChange', () => {
  it('stays put once the URL carries the draft', () => {
    expect(draftChange({ draft: 'courgette', pushed: 'courgette' })).toEqual({
      navigate: false,
    })
  })

  it('spends a history entry on entering the search', () => {
    expect(draftChange({ draft: 'c', pushed: '' })).toEqual({
      navigate: true,
      q: 'c',
      replace: false,
    })
  })

  it('replaces for a keystroke that outran the previous navigation', () => {
    expect(draftChange({ draft: 'cou', pushed: 'c' })).toEqual({
      navigate: true,
      q: 'cou',
      replace: true,
    })
  })

  it('drops q from the URL when the field is emptied', () => {
    expect(draftChange({ draft: '', pushed: 'courgette' })).toEqual({
      navigate: true,
      q: undefined,
      replace: true,
    })
  })
})
