import { describe, expect, it } from 'vitest'
import { uploadProgress } from './uploadProgress'

describe('uploadProgress fraction', () => {
  it('gives the compression most of one file', () => {
    expect(
      uploadProgress({ done: 0, total: 1, phase: 'ticket' }).fraction,
    ).toBe(0.6)
  })

  it('advances file by file', () => {
    expect(
      uploadProgress({ done: 3, total: 12, phase: 'compression' }).fraction,
    ).toBe(0.25)
  })

  it('never reports more than a finished batch', () => {
    expect(
      uploadProgress({ done: 12, total: 12, phase: 'upload' }).fraction,
    ).toBe(1)
  })

  it('answers zero rather than dividing by nothing', () => {
    expect(
      uploadProgress({ done: 0, total: 0, phase: 'upload' }).fraction,
    ).toBe(0)
  })

  it('rises within one file as the phases pass', () => {
    const phases = (['compression', 'ticket', 'upload'] as const).map(
      (phase) => uploadProgress({ done: 1, total: 4, phase }).fraction,
    )
    expect(phases).toEqual([...phases].sort((a, b) => a - b))
  })
})

describe('uploadProgress text', () => {
  it('counts the pages of a batch', () => {
    expect(
      uploadProgress({ done: 2, total: 12, phase: 'compression' }).text,
    ).toBe('Compression 3 / 12 pages…')
  })

  it('says the phase alone for a single file', () => {
    expect(uploadProgress({ done: 0, total: 1, phase: 'upload' }).text).toBe(
      'Envoi…',
    )
  })

  it('never counts past the batch', () => {
    expect(uploadProgress({ done: 12, total: 12, phase: 'upload' }).text).toBe(
      'Envoi 12 / 12 pages…',
    )
  })

  it('reads both halves off the same counters', () => {
    const view = uploadProgress({ done: 3, total: 12, phase: 'compression' })
    expect(view).toEqual({ fraction: 0.25, text: 'Compression 4 / 12 pages…' })
  })
})
