import { describe, expect, test } from 'vitest'
import {
  BEAUTIFY_FAILURE_KINDS,
  beautifyFailureKind,
} from './beautifyFailureKinds'
import type { DecodeFailureReason } from './beautifyFailureKinds'
import { FAILURE_KINDS } from './failureKinds'

describe('beautification failure taxonomy', () => {
  test('maps every bench reason onto a kind the validator accepts', () => {
    const reasons: DecodeFailureReason[] = ['refusal', 'truncation', 'no_image']
    for (const reason of reasons) {
      expect(BEAUTIFY_FAILURE_KINDS).toContain(beautifyFailureKind(reason))
    }
    // The one that does not carry over: the bench spells it as a noun, the journal as a participle.
    expect(beautifyFailureKind('truncation')).toBe('truncated')
  })

  test('is not the extraction taxonomy', () => {
    // `no_image` has no equivalent there, and three extraction kinds describe a JSON payload no
    // image call can ever produce. Reusing one tuple for both would have written unstorable values.
    expect(BEAUTIFY_FAILURE_KINDS).toContain('no_image')
    expect(FAILURE_KINDS).not.toContain('no_image')
    for (const kind of ['invalid_json', 'invalid_schema', 'no_recipes']) {
      expect(BEAUTIFY_FAILURE_KINDS).not.toContain(kind)
    }
  })
})
