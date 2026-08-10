export type LadderRung = {
  model: string
  // Catalogue price for image output, in USD per output token.
  imageOutputUsdPerToken: number
  // Budget guard, checked before the call. Must stay pessimistic: an optimistic guard lets spending
  // run past intent, which is the one failure mode a guard exists to prevent.
  maxCostUsdPerCall: number
}

// Measured, not assumed. The 2026-08-10 shape probe on gpt-5-image-mini billed 5361 output tokens
// for one image — 4x the ~1300 an image alone costs — because that family emits `reasoning` and
// `reasoning_details` alongside the image. A 2000-token ceiling made the guard 3.3x OPTIMISTIC
// against a real call ($0.016 budgeted, $0.0525 actual). 8000 covers the observed worst case and
// keeps the whole grid's guarded total under the hard cap.
const OUTPUT_TOKEN_CEILING = 8000

function rung(model: string, imageOutputUsdPerToken: number): LadderRung {
  return {
    model,
    imageOutputUsdPerToken,
    maxCostUsdPerCall: imageOutputUsdPerToken * OUTPUT_TOKEN_CEILING,
  }
}

// OpenRouter listed 7 distinct image-output models on 2026-08-09 (11 declaring `image` in
// `architecture.output_modalities`, minus the two `openrouter/auto*` routers and the two `-preview`
// duplicates). The spike covers only the four cheapest: the three left out — gpt-5-image at
// 0.00004, gemini-3.1-flash-image at 0.00006 and gemini-3-pro-image at 0.00012 — carried two thirds
// of the spend for models that would only ever be a last resort. A negative verdict on these four
// therefore does not condemn the top of the ladder; it condemns its cheap half.
//
// This order is by CATALOGUE RATE and is not the real cost order: the probe showed gpt-5-image-mini
// billing $0.0525 per image against ~$0.039 expected for a Gemini image model, so the nominally
// cheapest rung is likely the most expensive call. Which model is actually cheapest is settled by
// the measured `usage.cost` in the results table, never by this list.
export const LADDER: readonly LadderRung[] = [
  rung('openai/gpt-5-image-mini', 0.000008),
  rung('google/gemini-2.5-flash-image', 0.00003),
  rung('google/gemini-3.1-flash-lite-image', 0.00003),
  rung('openai/gpt-5.4-image-2', 0.00003),
]

// Retained on 2026-08-10 by florianlauer, on the v2 renders. Measured at $0.0393 per image and 9s,
// it is both cheaper and 6x faster than the OpenAI rung that also passes, and it clears barrier 1 on
// the wide shots. This is the value T14 must configure.
export const BEAUTIFY_MODEL = 'google/gemini-2.5-flash-image'

// Model ids carry a slash; renders live one directory per model, so the slash has to go.
export function modelSlug(model: string): string {
  return model.replace('/', '__')
}
