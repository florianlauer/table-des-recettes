import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

import { PROMPT_VERSION, RESTORATION_PROMPT } from './prompt.js'

/**
 * The application cannot import this module — the bench sits outside its `tsconfig` — so the prompt
 * lives twice, and only a comment used to say the two copies must agree. The drift it guards against
 * is silent and expensive: production would keep paying for a prompt no bench ever measured, and the
 * journal would file the calls under a version that did not produce them.
 *
 * Read from disk rather than imported, for the same reason in reverse: the bench's `tsconfig` cannot
 * resolve the application's modules either.
 */
const PRODUCTION_MODULE = 'src/shared/beautifyPrompt.ts'

async function productionModule(): Promise<string> {
  return readFile(PRODUCTION_MODULE, 'utf8')
}

function captured(source: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(source)
  if (!match?.[1])
    throw new Error(`${what} introuvable dans ${PRODUCTION_MODULE}.`)
  return match[1]
}

describe('the production copy of the retained prompt', () => {
  test('carries the same text, to the byte', async () => {
    const source = await productionModule()
    const prompt = captured(
      source,
      /BEAUTIFY_PROMPT = `([\s\S]*?)`\n/,
      'BEAUTIFY_PROMPT',
    )
    expect(prompt).toBe(RESTORATION_PROMPT)
  })

  test('files its calls under the version that produced them', async () => {
    const source = await productionModule()
    const version = captured(
      source,
      /BEAUTIFY_PROMPT_VERSION = '([^']+)'/,
      'BEAUTIFY_PROMPT_VERSION',
    )
    expect(version).toBe(PROMPT_VERSION)
  })
})
