/**
 * Where a recipe stands in the photo work, denormalised so the work screen reads it from an index
 * instead of scanning. Lives here rather than in the schema for the same reason as `RECIPE_TYPES`:
 * the values are the contract, the validator is one consumer of it.
 */
export const ILLUSTRATION_STAGES = [
  'missing',
  'source-has-none',
  'to-beautify',
  'done',
] as const

export type IllustrationStage = (typeof ILLUSTRATION_STAGES)[number]

/** Generic over the id so the Convex side can pass a branded `Id<"_storage">`. */
export type IllustrationInput = {
  imageStorageId: string | undefined
  beautifiedAccepted: boolean
  noPhotoAvailable: boolean
}

/**
 * The stage is a pure function of three fields, never authored by hand. `noPhotoAvailable` only
 * speaks when there is no photo, and `beautifiedAccepted` only when there is one — which is why one
 * key can carry both halves of the answer.
 */
export function stageOf({
  imageStorageId,
  beautifiedAccepted,
  noPhotoAvailable,
}: IllustrationInput): IllustrationStage {
  if (imageStorageId === undefined)
    return noPhotoAvailable ? 'source-has-none' : 'missing'
  return beautifiedAccepted ? 'done' : 'to-beautify'
}
