import { describe, expect, it } from 'vitest'
import { uploadFraction, uploadNote } from './uploadProgress'

describe('uploadFraction', () => {
  it('gives the compression most of one file', () => {
    expect(uploadFraction({ done: 0, total: 1, phase: 'ticket' })).toBe(0.6)
  })

  it('advances file by file', () => {
    expect(uploadFraction({ done: 3, total: 12, phase: 'compression' })).toBe(
      0.25,
    )
  })

  it('never reports more than a finished batch', () => {
    expect(uploadFraction({ done: 12, total: 12, phase: 'upload' })).toBe(1)
  })

  it('answers zero rather than dividing by nothing', () => {
    expect(uploadFraction({ done: 0, total: 0, phase: 'upload' })).toBe(0)
  })

  it('rises within one file as the phases pass', () => {
    const phases = (['compression', 'ticket', 'upload'] as const).map((phase) =>
      uploadFraction({ done: 1, total: 4, phase }),
    )
    expect(phases).toEqual([...phases].sort((a, b) => a - b))
  })
})

describe('uploadNote', () => {
  it('counts the pages of a batch', () => {
    expect(uploadNote({ done: 2, total: 12, phase: 'compression' })).toBe(
      'Compression 3 / 12 pages…',
    )
  })

  it('says the phase alone for a single file', () => {
    expect(uploadNote({ done: 0, total: 1, phase: 'upload' })).toBe('Envoi…')
  })

  it('never counts past the batch', () => {
    expect(uploadNote({ done: 12, total: 12, phase: 'upload' })).toBe(
      'Envoi 12 / 12 pages…',
    )
  })
})
