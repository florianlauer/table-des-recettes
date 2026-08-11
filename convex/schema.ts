import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { FAILURE_KINDS } from '../src/lib/failureKinds'
import { RECIPE_TYPES } from '../src/lib/recipeTypes'
import { literalUnion } from './lib/validators'

export const recipeType = literalUnion(RECIPE_TYPES)

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
export const attemptRecord = v.object({
  attemptId: v.string(),
  model: v.string(),
  servedProvider: v.union(v.string(), v.null()),
  latencyMs: v.number(),
  costUsd: v.number(),
  failureKind: v.union(literalUnion(FAILURE_KINDS), v.null()),
  repairCount: v.number(),
})

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
    beautifyStatus: literalUnion([
      'idle',
      'generating',
      'review',
      'failed',
    ] as const),
    beautifyAttemptId: v.optional(v.string()),
    beautifyError: v.optional(v.string()),
    // Compare-and-set token for the correction form. An integer, not a timestamp: two writes in the
    // same millisecond would mint the same token and let the stale one through.
    revision: v.optional(v.number()),
  })
    .index('by_status_type', ['status', 'type'])
    .index('by_slug', ['slug'])
    .index('by_scan', ['scanId'])
    .searchIndex('search_recipes', {
      searchField: 'searchText',
      filterFields: ['status', 'type'],
    }),

  uploadTickets: defineTable({
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
    storageId: v.optional(v.id('_storage')),
    scanId: v.optional(v.id('scans')),
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
