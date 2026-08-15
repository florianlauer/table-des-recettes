/**
 * What each deployment pins, which is the only half of « est-ce la configuration en service » that
 * differs between the two journals. Comparing a group against it is one rule, in `journalStats`.
 *
 * Server-side only: the extraction model *and its provider* come from the environment, so the
 * browser cannot work this out on its own. The environment arrives as a parameter rather than being
 * read here, the same way `extractImages` takes `environment = process.env` — that is what makes it
 * testable.
 */
import { BEAUTIFY_MODEL, BEAUTIFY_PROMPT_VERSION } from './beautifyPrompt'
import { PROMPT_VERSION } from './recipe-prompt'
import { RECIPE_SCHEMA_VERSION } from './recipe-schema'
import type { ServiceIdentity } from './journalStats'

export type ExtractionEnvironment = {
  OPENROUTER_MODEL?: string
  OPENROUTER_PROVIDER?: string
}

export function configuredExtractionIdentity(
  environment: ExtractionEnvironment,
): ServiceIdentity | null {
  const model = environment.OPENROUTER_MODEL ?? ''
  const provider = environment.OPENROUTER_PROVIDER ?? ''
  // Extraction refuses to run without both, so a half-configured deployment has no identity in
  // service at all — and therefore no estimate.
  if (!model || !provider) return null
  return {
    model,
    provider,
    promptVersion: PROMPT_VERSION,
    schemaVersion: RECIPE_SCHEMA_VERSION,
  }
}

/**
 * Beautification pins no provider and has no schema, so neither splits what counts as in service:
 * several groups of the current model may be marked, and the estimate averages them.
 */
export function configuredBeautifyIdentity(): ServiceIdentity {
  return { model: BEAUTIFY_MODEL, promptVersion: BEAUTIFY_PROMPT_VERSION }
}
