import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { BEAUTIFY_FAILURE_KINDS } from '../src/lib/beautifyFailureKinds'
import { FAILURE_KINDS } from '../src/lib/failureKinds'
import { RECIPE_TYPES } from '../src/lib/recipeTypes'
import { literalUnion } from './lib/validators'

export const recipeType = literalUnion(RECIPE_TYPES)

export const uploadPurpose = literalUnion(['scan', 'illustration'] as const)

export const beautifyStatus = literalUnion([
  'idle',
  'generating',
  'review',
  'failed',
] as const)

/**
 * Not a nullable boolean. A finalisation that arrives too late was still billed, so it has to be
 * journalled — but no arbitration is possible on it, which is neither "waiting" nor "judged":
 * `discarded`. A boolean would have forced a choice between understating the spend and inflating
 * the review queue.
 */
export const beautifyOutcome = literalUnion([
  'pending',
  'accepted',
  'rejected',
  'discarded',
] as const)

export const scanStatus = literalUnion([
  'pending',
  'extracting',
  'done',
  'failed',
] as const)

export const ingredient = v.object({
  raw: v.string(),
  quantity: v.optional(v.number()),
  unit: v.optional(v.string()),
  label: v.optional(v.string()),
})

// Nullable rather than optional, throughout: an absent field would force every producer and every
// reader to spread it conditionally, which is where the five copies of
// `...(x === undefined ? {} : { x })` came from.
export const attemptFields = {
  attemptId: v.string(),
  model: v.string(),
  servedProvider: v.union(v.string(), v.null()),
  latencyMs: v.number(),
  costUsd: v.number(),
  failureKind: v.union(literalUnion(FAILURE_KINDS), v.null()),
  repairCount: v.number(),
}

export const attemptRecord = v.object(attemptFields)

export default defineSchema({
  scans: defineTable({
    imageStorageIds: v.array(v.id('_storage')),
    status: scanStatus,
    attemptId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    attempts: v.number(),
    error: v.optional(v.string()),
    lastAttempt: v.optional(attemptRecord),
    purgeAfter: v.optional(v.number()),
    purgedAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    // Set when the image set moves after an extraction, cleared by a rescan or by an explicit
    // acknowledgement. It blocks publication: recipes read from replaced sources must not reach the
    // storefront unreviewed.
    imagesChangedAt: v.optional(v.number()),
    // `attempts` is reset by a rescan, so it cannot answer "what did this scan consume". These two
    // never reset. Reservations are not billed calls — a missing blob fails before the request —
    // which is why the money question is answered by the accumulated cost, not by the count.
    totalReservations: v.optional(v.number()),
    totalCostUsd: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_status_started_at', ['status', 'startedAt'])
    .index('by_purge_after', ['purgeAfter']),

  recipes: defineTable({
    scanId: v.optional(v.id('scans')),
    title: v.string(),
    slug: v.optional(v.string()),
    type: recipeType,
    servings: v.optional(v.number()),
    ingredients: v.array(ingredient),
    ingredientsInferred: v.boolean(),
    steps: v.array(v.string()),
    searchText: v.string(),
    status: literalUnion(['review', 'published'] as const),
    publishedAt: v.optional(v.number()),
    imageStorageId: v.optional(v.id('_storage')),
    beautifiedStorageId: v.optional(v.id('_storage')),
    beautifiedAccepted: v.boolean(),
    beautifyStatus,
    beautifyAttemptId: v.optional(v.string()),
    beautifyError: v.optional(v.string()),
    // When the current generation was started. Without it an action killed before its failure
    // mutation leaves the recipe `generating` forever, with nothing on screen saying so.
    beautifyStartedAt: v.optional(v.number()),
    // Denormalised so "which recipes still have no photo" is an indexed read. Optional because a
    // required boolean would reject every existing recipe; `migrations` carries the backfill, and
    // `withIllustration` is the only thing allowed to write it.
    hasIllustration: v.optional(v.boolean()),
    // Compare-and-set token for the correction form. An integer, not a timestamp: two writes in the
    // same millisecond would mint the same token and let the stale one through.
    revision: v.optional(v.number()),
  })
    .index('by_status_type', ['status', 'type'])
    .index('by_slug', ['slug'])
    .index('by_scan', ['scanId'])
    .index('by_illustration', ['hasIllustration'])
    .index('by_beautify_status', ['beautifyStatus'])
    .searchIndex('search_recipes', {
      searchField: 'searchText',
      filterFields: ['status', 'type'],
    }),

  // The journal `scans.lastAttempt` cannot be: it keeps only the last attempt, and it dies with the
  // scan. Reading whether the cheap model still holds needs the retries and the purged scans too,
  // so the rows live on their own and `scanId` is deliberately allowed to dangle.
  extractionAttempts: defineTable({
    ...attemptFields,
    scanId: v.id('scans'),
    promptVersion: v.string(),
    schemaVersion: v.string(),
    createdAt: v.number(),
  }).index('by_created_at', ['createdAt']),

  /**
   * The extraction journal cannot be reused: its `failureKind` is typed on the extraction taxonomy
   * and its `scanId` is mandatory, while an illustration belongs to a recipe and may outlive every
   * scan. `outcome` is what makes this a journal of *arbitrations* and not only of calls.
   */
  beautifyAttempts: defineTable({
    attemptId: v.string(),
    recipeId: v.id('recipes'),
    model: v.string(),
    promptVersion: v.string(),
    servedProvider: v.union(v.string(), v.null()),
    latencyMs: v.number(),
    costUsd: v.number(),
    // A response without `usage.cost` is journalled at zero; without this flag the aggregate would
    // read a missing price as a free call.
    costReported: v.boolean(),
    // Explicitly nullable, with the invariant tested: `pending | accepted | rejected` carry no
    // failure, a *technical* `discarded` always does, and a `discarded` that merely arrived too
    // late carries none either — there, `outcome` alone tells the story.
    failureKind: v.union(literalUnion(BEAUTIFY_FAILURE_KINDS), v.null()),
    // The original the candidate was rendered from. Finalisation compares it against the recipe:
    // an image replaced meanwhile must not inherit a candidate made from the previous one.
    sourceStorageId: v.id('_storage'),
    outcome: beautifyOutcome,
    createdAt: v.number(),
  })
    .index('by_created_at', ['createdAt'])
    // Not a unique constraint — Convex has none. It is what lets every journalling mutation read
    // before it inserts, which is how a replayed finalisation stops counting its cost twice.
    .index('by_attempt_id', ['attemptId']),

  /** Durable progress of the batched backfills. One row per migration, keyed by name. */
  migrations: defineTable({
    name: v.string(),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    migrated: v.number(),
    updatedAt: v.number(),
  }).index('by_name', ['name']),

  uploadTickets: defineTable({
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
    storageId: v.optional(v.id('_storage')),
    scanId: v.optional(v.id('scans')),
    // Written when the ticket is issued. Without it the two rate-limit buckets are decoration: a
    // ticket drawn on the scan quota would serve to illustrate. Tickets predating the field are
    // read as `scan`.
    purpose: v.optional(uploadPurpose),
    // Written when an illustration ticket is consumed, and it is what makes a replay decidable:
    // the same pair is a success, a different one is a refusal that destroys nothing.
    recipeId: v.optional(v.id('recipes')),
    // `rejected` is deliberately generic: the guards that can refuse an upload keep growing, and the
    // precise reason already has a home in `error`.
    outcome: v.optional(
      literalUnion(['ok', 'missing_storage', 'too_large', 'rejected'] as const),
    ),
    error: v.optional(v.string()),
  })
    .index('by_created_at', ['createdAt'])
    .index('by_consumed_at_created_at', ['consumedAt', 'createdAt']),
})
