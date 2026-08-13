import { describe, expect, it } from 'vitest'
import { scanNotes } from './scanNotes'
import type { ScannedForNotes } from './scanNotes'

const NOW = 1_760_000_000_000

function scan(overrides: Partial<ScannedForNotes> = {}): ScannedForNotes {
  return {
    drafts: [],
    draftsTruncated: false,
    error: null,
    purgedAt: null,
    lastAttempt: null,
    ...overrides,
  }
}

describe('scanNotes', () => {
  it('says nothing about a scan that has nothing to report', () => {
    expect(scanNotes({ scan: scan(), now: NOW })).toEqual([])
  })

  it('names an untitled draft rather than showing a gap', () => {
    const notes = scanNotes({
      scan: scan({
        drafts: [
          { title: 'Crème de courgette', ingredientsInferred: false },
          { title: '', ingredientsInferred: false },
        ],
      }),
      now: NOW,
    })
    expect(notes).toEqual(['Crème de courgette · sans titre'])
  })

  it('puts the failure first, and the cost of the last call last', () => {
    const notes = scanNotes({
      scan: scan({
        error: 'schéma invalide',
        drafts: [{ title: 'Gratin', ingredientsInferred: true }],
        lastAttempt: {
          model: 'gemini-2.5-flash',
          servedProvider: 'google',
          latencyMs: 8420,
          costUsd: 0.0123,
          failureKind: 'schema',
          repairCount: 2,
        },
      }),
      now: NOW,
    })

    expect(notes[0]).toBe('Échec : schéma invalide')
    expect(notes).toContain('Ingrédients déduits à vérifier.')
    // The group separator is a no-break space, of a width ICU may spell either way.
    expect(notes[notes.length - 1]).toMatch(
      /^gemini-2\.5-flash · google · 8\s420 ms · 0,0123 USD · schema · 2 réparations$/u,
    )
  })

  it('warns before listing when the drafts are truncated', () => {
    const notes = scanNotes({
      scan: scan({
        draftsTruncated: true,
        drafts: [{ title: 'A', ingredientsInferred: false }],
      }),
      now: NOW,
    })
    expect(notes[0]).toBe(
      'Plus de 1 brouillons : extraction probablement défectueuse.',
    )
  })

  it('reads a purge as an age, not a timestamp', () => {
    const notes = scanNotes({
      scan: scan({ purgedAt: NOW - 3 * 60 * 60 * 1000 }),
      now: NOW,
    })
    expect(notes[0]).toMatch(/^Photo purgée il y a .+\.$/u)
  })

  it('says a missing provider rather than leaving the field empty', () => {
    const notes = scanNotes({
      scan: scan({
        lastAttempt: {
          model: 'gemini-2.5-flash',
          servedProvider: null,
          latencyMs: 1000,
          costUsd: 0.001,
          failureKind: null,
          repairCount: 0,
        },
      }),
      now: NOW,
    })
    expect(notes[0]).toContain('provider inconnu')
    expect(notes[0]).toContain('succès')
  })
})
