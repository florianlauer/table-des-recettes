import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { settleAttempt } from './beautifyJournal'
import { deleteStoredBlob } from './blobs'
import { restaged, touchedIllustration } from './recipeWrites'
import { clearRendition } from './renditions'
import type { RenditionPatch } from './renditions'

/**
 * What a gesture did to the photo slot. Attaching an image that is already there is not a mistake —
 * it is the replay of an upload — so the previous blob only dies when it is a different one.
 */
type PhotoIntent = { attach: Id<'_storage'> } | 'detach'

/**
 * What a gesture did to the candidate slot. `drop` is the whole disappearance: the blob, its
 * derivative, and the journal row that would otherwise claim a verdict nobody gave.
 */
type CandidateIntent = { adopt: Id<'_storage'> } | 'drop'

/**
 * Where the generation stands afterwards. `cancel` is the one that reads the document: a render
 * still running is cancelled whole and says why, a recipe that was not generating simply goes back
 * to rest.
 */
type GenerationIntent =
  { start: string } | { failed: string } | { cancel: string } | 'review'

/**
 * The three things a gesture can do to the two image slots, and never two at once. A union rather
 * than three optional keys because the combinations are not meaningful: a photo being replaced takes
 * the candidate with it, and an arbitration is about a candidate that is already there.
 *
 * `photo` therefore carries its own consequences instead of asking the caller to restate them — the
 * candidate goes, and an attach clears the "the coupure has no photo" flag. Leaving those to be
 * named at the call site is exactly the forgetting this module exists to end.
 */
type SlotIntent =
  | { photo: PhotoIntent; candidate?: never; arbitrate?: never }
  | { candidate: CandidateIntent; photo?: never; arbitrate?: never }
  /**
   * The verdict, and everything it implies: the journal row settled, the generation back at rest,
   * the embellishment published or its candidate destroyed. One word, because a gesture that could
   * name the verdict without the publication — or the reverse — would be a gesture that can get an
   * arbitration half-right, silently.
   */
  | { arbitrate: 'accepted' | 'rejected'; photo?: never; candidate?: never }
  /** A gesture that touches neither slot: the flag, the de-publication, the generation alone. */
  | { photo?: never; candidate?: never; arbitrate?: never }

/**
 * One gesture's effect on a recipe's illustration, said in the terms the screen says it in.
 *
 * Everything a gesture used to have to remember is derived from here: which blobs die, which
 * derivatives go with them, whether the attempt is settled, whether the three stage keys are
 * recomputed, and the date the work queue orders on. A gesture that names its effect cannot forget
 * a consequence of it, which is the whole reason this type is not a patch.
 */
export type IllustrationIntent = {
  /** Takes the embellishment off the storefront. The candidate blob and its verdict both survive. */
  unpublish?: true
  /** The operator's own statement about the coupure: it carries no photo. */
  noPhotoAvailable?: boolean
  generation?: GenerationIntent
} & SlotIntent

/** The four fields the generation lifecycle owns, and the only ones it may write. */
type GenerationPatch = Partial<
  Pick<
    Doc<'recipes'>,
    | 'beautifyStatus'
    | 'beautifyError'
    | 'beautifyAttemptId'
    | 'beautifyStartedAt'
  >
>

const AT_REST: GenerationPatch = {
  beautifyStatus: 'idle',
  beautifyError: undefined,
  beautifyAttemptId: undefined,
  beautifyStartedAt: undefined,
}

function failedWith(error: string): GenerationPatch {
  return {
    beautifyStatus: 'failed',
    beautifyError: error,
    beautifyAttemptId: undefined,
    beautifyStartedAt: undefined,
  }
}

function generationPatch(
  recipe: Doc<'recipes'>,
  intent: GenerationIntent,
  at: number,
): GenerationPatch {
  if (intent === 'review')
    // The attempt id survives on purpose: it is what arbitration consumes, and clearing it here
    // would make the candidate unjudgeable the moment it becomes judgeable.
    return {
      beautifyStatus: 'review',
      beautifyError: undefined,
      beautifyStartedAt: undefined,
    }
  if ('start' in intent)
    return {
      beautifyStatus: 'generating',
      beautifyAttemptId: intent.start,
      beautifyStartedAt: at,
      beautifyError: undefined,
    }
  if ('failed' in intent) return failedWith(intent.failed)
  // A generation still running is cancelled whole, not half. Clearing only the attempt id — as an
  // earlier design did — left the recipe `generating` until a lease expired by hand: blocked, with
  // nothing on screen saying why.
  return recipe.beautifyStatus === 'generating'
    ? failedWith(intent.cancel)
    : AT_REST
}

/** The three fields the stage is a function of, named only when the gesture changed one. */
type StageChange = Partial<{
  imageStorageId: Id<'_storage'> | undefined
  beautifiedAccepted: boolean
  noPhotoAvailable: boolean
}>

/**
 * What the gesture changed of the three, consequences included: attaching a photo clears the flag
 * rather than leaving it dormant — a state that says "the coupure has no photo" next to a photo
 * would be a state that lies — and an accepted arbitration is what publishes the embellishment.
 *
 * `null` when the gesture touched none of them, which is the signal to bump the queue date alone.
 */
function stageChange({
  photo,
  arbitrate,
  unpublish,
  noPhotoAvailable,
}: IllustrationIntent): StageChange | null {
  const change: StageChange = {
    // Spread rather than assigned, and the key survives carrying `undefined`: that is what removes
    // the field on a detach, where an absent key would leave the photo in place.
    ...(photo === undefined
      ? {}
      : photo === 'detach'
        ? { imageStorageId: undefined }
        : { imageStorageId: photo.attach, noPhotoAvailable: false }),
    ...(arbitrate === 'accepted' ? { beautifiedAccepted: true } : {}),
    ...(unpublish ? { beautifiedAccepted: false } : {}),
    ...(noPhotoAvailable === undefined ? {} : { noPhotoAvailable }),
  }
  return Object.keys(change).length > 0 ? change : null
}

/**
 * The photo slot's destructions. The derivative always goes: it describes bytes that are being
 * replaced or removed, and kept it would be a blob nothing references.
 */
async function applyPhoto(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
  intent: PhotoIntent,
): Promise<RenditionPatch> {
  const superseded =
    intent === 'detach' || recipe.imageStorageId !== intent.attach
  if (recipe.imageStorageId && superseded)
    await deleteStoredBlob(ctx, recipe.imageStorageId)
  return clearRendition(ctx, recipe, 'original')
}

/**
 * The candidate slot's destructions. `drop` also settles: billed, destroyed, never judged.
 * `discarded` keeps the money counted and says no arbitration was possible — `rejected` would claim
 * a verdict nobody gave. It is a no-op on an attempt already settled, which is what lets a rejection
 * name its own verdict and still drop the blob.
 *
 * Both the clearing and the settling run whether or not the slot held a blob, where the gesture-side
 * version returned early. Neither can reach anything live: an attempt is only journalled `pending` in
 * the transaction that already moved the recipe to `review`, where the blob is always present, and a
 * rendition without its source is already dead to readers through the compare-and-set on
 * `sourceStorageId`. What they collect is an orphan.
 *
 * The deletion on `adopt` is defensive: `requestBeautify` empties the slot before anything can enter
 * `generating`, so a superseded candidate is unreachable from here today.
 */
async function applyCandidate(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
  intent: CandidateIntent,
): Promise<RenditionPatch & { beautifiedStorageId?: Id<'_storage'> }> {
  const adopted = intent === 'drop' ? undefined : intent.adopt
  if (recipe.beautifiedStorageId && recipe.beautifiedStorageId !== adopted)
    await deleteStoredBlob(ctx, recipe.beautifiedStorageId)
  const cleared = await clearRendition(ctx, recipe, 'beautified')
  if (intent === 'drop')
    await settleAttempt(ctx, recipe.beautifyAttemptId, 'discarded')
  return { ...cleared, beautifiedStorageId: adopted }
}

/**
 * The single writer of a recipe's illustration. Every gesture on the photo screen, and both outcomes
 * of a render, go through here.
 *
 * It exists because the consequences were spread over twelve patch sites that each had to remember
 * them: the stage keys to recompute, the date the work queue orders on, the derivative to destroy
 * with its source, the journal row to settle. The compiler can prove a call that goes through a
 * helper is complete, never that a call which should go through it does — so the rule was held by a
 * test maintaining an inventory of function names, which is what a missing module looks like.
 *
 * `at` is positional: spread into a patch it would become a stray key the schema rejects.
 */
export async function writeIllustration(
  ctx: MutationCtx,
  recipe: Doc<'recipes'>,
  intent: IllustrationIntent,
  at: number,
): Promise<void> {
  const { photo, candidate, arbitrate, generation } = intent

  // Before the drop below, whose `discarded` only writes an attempt still pending.
  if (arbitrate) await settleAttempt(ctx, recipe.beautifyAttemptId, arbitrate)

  // The original leaving takes the candidate with it: one rendered from an image that no longer
  // exists cannot be compared against the one that replaced it, and the arbitration screen would be
  // showing two pictures of different things and calling it a choice. A rejection destroys it for
  // the plainer reason that it has just been refused.
  const slot: CandidateIntent | undefined =
    photo || arbitrate === 'rejected' ? 'drop' : candidate

  const patched = photo ? await applyPhoto(ctx, recipe, photo) : {}
  const dropped = slot ? await applyCandidate(ctx, recipe, slot) : {}

  const change = stageChange(intent)
  await ctx.db.patch(recipe._id, {
    // The stage is a function of three fields, so it is recomputed exactly when one of them is
    // named. Every other gesture still moves the date: `beautifyStatus` is the second key of the
    // work index, so a recipe coming back from arbitration changes section while its stage stands
    // still — and without the bump it would land at the bottom of a capped section, at the date its
    // photo was attached.
    ...(change ? restaged(recipe, change, at) : touchedIllustration(at)),
    ...patched,
    ...dropped,
    // An arbitration always ends at rest, whatever its verdict.
    ...(arbitrate
      ? AT_REST
      : generation
        ? generationPatch(recipe, generation, at)
        : {}),
  })
}
