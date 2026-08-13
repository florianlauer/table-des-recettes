import { describe, expect, it } from 'vitest'
import { dataView } from './dataView'

const base = {
  tokenAbsent: false,
  loading: false,
  error: null,
  data: [1, 2] as number[] | undefined,
}

describe('dataView', () => {
  it('says the token is missing before saying anything about the server', () => {
    const view = dataView({
      ...base,
      tokenAbsent: true,
      loading: true,
      error: new Error('boom'),
    })
    expect(view.kind).toBe('absent')
  })

  it('reports a failure even when the previous answer is still in hand', () => {
    const view = dataView({ ...base, error: new Error('boom') })
    expect(view).toEqual({ kind: 'failed', error: new Error('boom') })
  })

  it('is loading while there is nothing yet, flag or no flag', () => {
    expect(dataView({ ...base, loading: true }).kind).toBe('loading')
    expect(dataView({ ...base, data: undefined }).kind).toBe('loading')
  })

  it('hands the data over once, narrowed, so no caller re-checks it', () => {
    const view = dataView(base)
    expect(view.kind).toBe('ready')
    // The point of the union: `data` exists here and nowhere else.
    if (view.kind === 'ready') expect(view.data).toEqual([1, 2])
  })

  it('treats an empty answer as an answer', () => {
    // Emptiness belongs to the data, not to the query — the block that renders rows says what an
    // empty list means, next to where it would have drawn them.
    expect(dataView({ ...base, data: [] })).toEqual({ kind: 'ready', data: [] })
  })
})
