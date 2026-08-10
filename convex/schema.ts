import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { RECIPE_TYPES } from '../src/lib/recipeTypes'

const recipeTypeLiterals = RECIPE_TYPES.map((type) => v.literal(type)) as [
  ReturnType<typeof v.literal<(typeof RECIPE_TYPES)[0]>>,
  ReturnType<typeof v.literal<(typeof RECIPE_TYPES)[1]>>,
  ReturnType<typeof v.literal<(typeof RECIPE_TYPES)[2]>>,
  ReturnType<typeof v.literal<(typeof RECIPE_TYPES)[3]>>,
  ReturnType<typeof v.literal<(typeof RECIPE_TYPES)[4]>>,
  ReturnType<typeof v.literal<(typeof RECIPE_TYPES)[5]>>,
]

export const recipeType = v.union(...recipeTypeLiterals)

export const ingredient = v.object({
  raw: v.string(),
  quantity: v.optional(v.number()),
  unit: v.optional(v.string()),
  label: v.optional(v.string()),
})

export default defineSchema({
  scans: defineTable({
    imageStorageIds: v.array(v.id('_storage')),
    status: v.union(
      v.literal('pending'),
      v.literal('extracting'),
      v.literal('done'),
      v.literal('failed'),
    ),
    attemptId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    attempts: v.number(),
    error: v.optional(v.string()),
    lastAttempt: v.optional(
      v.object({
        attemptId: v.string(),
        model: v.string(),
        servedProvider: v.optional(v.string()),
        latencyMs: v.number(),
        costUsd: v.number(),
        failureKind: v.optional(
          v.union(
            v.literal('refusal'),
            v.literal('truncated'),
            v.literal('invalid_json'),
            v.literal('invalid_schema'),
            v.literal('timeout'),
            v.literal('transport'),
            v.literal('no_recipes'),
            v.literal('invalid_image'),
          ),
        ),
        repairCount: v.number(),
      }),
    ),
    purgeAfter: v.optional(v.number()),
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
    status: v.union(v.literal('review'), v.literal('published')),
    publishedAt: v.optional(v.number()),
    imageStorageId: v.optional(v.id('_storage')),
    beautifiedStorageId: v.optional(v.id('_storage')),
    beautifiedAccepted: v.boolean(),
    beautifyStatus: v.union(
      v.literal('idle'),
      v.literal('generating'),
      v.literal('review'),
      v.literal('failed'),
    ),
    beautifyAttemptId: v.optional(v.string()),
    beautifyError: v.optional(v.string()),
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
    outcome: v.optional(
      v.union(
        v.literal('ok'),
        v.literal('missing_storage'),
        v.literal('too_large'),
      ),
    ),
    error: v.optional(v.string()),
  })
    .index('by_created_at', ['createdAt'])
    .index('by_consumed_at_created_at', ['consumedAt', 'createdAt']),
})
