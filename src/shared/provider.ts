/**
 * Copied out of `spike/openrouter.ts` rather than imported — the bench is not application code, the
 * same way `BEAUTIFY_MODEL` was copied out of `spike13/`.
 *
 * This is the one place where OpenRouter's two namespaces meet: a request pins a provider *slug*
 * (`google-ai-studio`) and a response names the provider it *served* (`Google AI Studio`). Comparing
 * them directly never matches, and a comparison that never matches here would silently mark every
 * journal group as not-current — no error, no log, just an estimate that never appears.
 */
export function normalizeProviderIdentifier(provider: string): string {
  return provider.toLocaleLowerCase('en').replace(/[\s_-]/g, '')
}
