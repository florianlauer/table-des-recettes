/**
 * Which journal group describes the configuration actually in service. Server-side only: the
 * extraction model *and its provider* come from the environment, so the browser cannot work this out
 * on its own — it only ever consumes the `isCurrent` flag the queries put on each group.
 *
 * The environment arrives as a parameter rather than being read here, the same way `runExtraction`
 * takes `environment = process.env` (`convex/extract.ts`): that is what makes it testable.
 */
import { BEAUTIFY_MODEL, BEAUTIFY_PROMPT_VERSION } from './beautifyPrompt'
import { normalizeProviderIdentifier } from './provider'
import { PROMPT_VERSION } from './recipe-prompt'
import { RECIPE_SCHEMA_VERSION } from './recipe-schema'

export type ExtractionEnvironment = {
  OPENROUTER_MODEL?: string
  OPENROUTER_PROVIDER?: string
}

export type ExtractionIdentity = {
  model: string
  provider: string
  promptVersion: string
  schemaVersion: string
}

export type BeautifyIdentity = { model: string; promptVersion: string }

/**
 * All four fields, not just the model: the groups are split by prompt and schema too, and comparing
 * only the model would keep an old group current after a prompt bump — `BEAUTIFY_PROMPT_VERSION`
 * moved from v3 to v4 while this screen was being designed.
 */
export function configuredExtractionIdentity(
  environment: ExtractionEnvironment,
): ExtractionIdentity | null {
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

export function configuredBeautifyIdentity(): BeautifyIdentity {
  return { model: BEAUTIFY_MODEL, promptVersion: BEAUTIFY_PROMPT_VERSION }
}

export function isCurrentAttemptGroup(
  group: {
    model: string
    servedProvider: string | null
    promptVersion: string
    schemaVersion: string
  },
  identity: ExtractionIdentity | null,
): boolean {
  if (identity === null) return false
  return (
    group.model === identity.model &&
    group.promptVersion === identity.promptVersion &&
    group.schemaVersion === identity.schemaVersion &&
    // The pinned slug and the served display name live in different namespaces.
    group.servedProvider !== null &&
    normalizeProviderIdentifier(group.servedProvider) ===
      normalizeProviderIdentifier(identity.provider)
  )
}

/**
 * Beautification pins no provider, so the served one is not part of what is "configured": several
 * groups of the current model may be marked, and the estimate averages them.
 */
export function isCurrentBeautifyGroup(
  group: { model: string; promptVersion: string },
  identity: BeautifyIdentity,
): boolean {
  return (
    group.model === identity.model &&
    group.promptVersion === identity.promptVersion
  )
}
