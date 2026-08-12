import { describe, expect, it } from 'vitest'
import {
  extractionMessage,
  outcomeMessage,
  purgeMessage,
  thrownMessage,
  uploadMessage,
} from './gestureMessages'

describe('purgeMessage', () => {
  it('confirms a purge', () => {
    expect(purgeMessage('purged')).toEqual({ ok: true, text: 'Photo purgée.' })
  })

  it('treats a deferred purge as a refusal, since nothing was purged', () => {
    expect(purgeMessage('deferred').ok).toBe(false)
  })

  it('treats an already purged photo as a success', () => {
    expect(purgeMessage('already_purged').ok).toBe(true)
  })
})

describe('extractionMessage', () => {
  it('confirms a scheduled extraction', () => {
    expect(extractionMessage({ status: 'scheduled' }, { now: 0 })).toEqual({
      ok: true,
      text: 'Extraction planifiée.',
    })
  })

  it('reports a queue already running', () => {
    expect(
      extractionMessage({ status: 'already_running' }, { now: 0 }).ok,
    ).toBe(false)
  })

  it('reports an empty queue', () => {
    expect(extractionMessage({ status: 'no_work' }, { now: 0 }).text).toBe(
      'Rien à extraire.',
    )
  })

  it('says how long a rate limit lasts', () => {
    expect(
      extractionMessage({ status: 'rate_limited', retryAt: 30_000 }, { now: 0 })
        .text,
    ).toBe('Limite atteinte. Reprise possible dans 30 s.')
  })
})

describe('uploadMessage', () => {
  it('counts what went through', () => {
    expect(uploadMessage({ total: 12, failures: [] })).toEqual({
      ok: true,
      text: '12 scan(s) créé(s).',
    })
  })

  it('names what failed rather than counting it', () => {
    expect(
      uploadMessage({
        total: 2,
        failures: ['a.jpg : trop lourd', 'b.jpg : refusé'],
      }),
    ).toEqual({ ok: false, text: 'a.jpg : trop lourd · b.jpg : refusé' })
  })
})

describe('outcomeMessage', () => {
  it('falls back to a plain confirmation', () => {
    expect(outcomeMessage({ ok: true })).toEqual({ ok: true, text: 'Fait.' })
  })

  it('prefers the sentence the caller phrased', () => {
    expect(outcomeMessage({ ok: true, message: '3 publiée(s).' }).text).toBe(
      '3 publiée(s).',
    )
  })

  it('carries a refusal through', () => {
    expect(outcomeMessage({ ok: false, error: 'Jeton invalide' })).toEqual({
      ok: false,
      text: 'Jeton invalide',
    })
  })

  it('never leaves a refusal wordless', () => {
    expect(outcomeMessage({ ok: false }).text).toBe('Échec.')
  })
})

describe('thrownMessage', () => {
  it('reads an Error', () => {
    expect(thrownMessage(new Error('réseau coupé'))).toEqual({
      ok: false,
      text: 'réseau coupé',
    })
  })

  it('reads a thrown string', () => {
    expect(thrownMessage('brut').text).toBe('brut')
  })

  it('still says something for a bare object', () => {
    expect(thrownMessage({ code: 500 })).toEqual({
      ok: false,
      text: 'Échec inattendu.',
    })
  })
})
