import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import { countPublishedByType } from './recipeCounts'
import schema from './schema'
import { RECIPE_TYPES } from '../src/lib/recipeTypes'
import type { RecipeType } from '../src/lib/recipeTypes'
import { registerComponents } from '../test/convexComponents'

const modules = import.meta.glob('./**/*.ts')
const adminToken = 'test-secret'

function setup() {
  const t = convexTest(schema, modules)
  registerComponents(t)
  return t
}

beforeEach(() => {
  process.env.ADMIN_TOKEN = adminToken
})

afterEach(() => {
  delete process.env.ADMIN_TOKEN
})

type Harness = ReturnType<typeof setup>

const zeroed = () =>
  Object.fromEntries(RECIPE_TYPES.map((type) => [type, 0])) as Record<
    RecipeType,
    number
  >

/** The same answer the scan `countsByType` used to run gives — computed here from the table. */
async function scanned(t: Harness) {
  return t.run(async (ctx) => {
    const byType = zeroed()
    const rows = await ctx.db
      .query('recipes')
      .withIndex('by_status_type', (q) => q.eq('status', 'published'))
      .collect()
    for (const row of rows) byType[row.type] += 1
    return { total: rows.length, byType }
  })
}

describe('what countsByType reads, and when', () => {
  /** Fixtures written straight to the table, as the historical corpus is: no aggregate entry. */
  async function unaggregated(t: Harness, types: Array<RecipeType>) {
    await t.run(async (ctx) => {
      for (const [index, type] of types.entries()) {
        const title = `${TITLES[index] ?? 'Recette'} ${index}`
        await ctx.db.insert('recipes', {
          status: 'published',
          publishedAt: 1,
          beautifiedAccepted: false,
          beautifyStatus: 'idle',
          ingredientsInferred: false,
          title,
          slug: `recette-${index}`,
          searchText: title.toLowerCase(),
          type,
          ingredients: [],
          steps: ['Étape unique.'],
        })
      }
    })
  }

  /** Distinct words, so a search can single one out — `Recette 0` and `Recette 1` both match "recette". */
  const TITLES = ['Blanquette', 'Pissaladiere', 'Riz', 'Chausson']

  test('falls back to the table until the backfill has run', async () => {
    const t = setup()
    await unaggregated(t, ['plat', 'plat', 'dessert'])

    // The aggregate holds nothing at all here. A public page reading it would announce an empty
    // shelf, which is why the fallback is not optional.
    expect(await t.run((ctx) => countPublishedByType(ctx))).toMatchObject({
      total: 0,
    })
    const counts = await t.query(api.recipes.countsByType, {})
    expect(counts.total).toBe(3)
    expect(counts.byType).toMatchObject({ plat: 2, dessert: 1 })
  })

  test('answers from the aggregate once the backfill is done', async () => {
    const t = setup()
    await unaggregated(t, ['plat', 'plat', 'dessert'])
    await t.mutation(internal.migrations.backfillRecipeCounts, {})
    await t.finishAllScheduledFunctions(() => {})

    expect(await t.query(api.recipes.countsByType, {})).toEqual(
      await scanned(t),
    )

    // Falsifiable: a row inserted behind the aggregate's back is invisible afterwards. That is the
    // whole cost of the fast read, and the reason `insertRecipeDoc` is the only insert in the
    // codebase.
    await unaggregated(t, ['apero'])
    expect((await scanned(t)).total).toBe(4)
    expect((await t.query(api.recipes.countsByType, {})).total).toBe(3)
  })

  test('a search still counts its own matches, aggregate or not', async () => {
    const t = setup()
    await unaggregated(t, ['plat', 'dessert'])
    await t.mutation(internal.migrations.backfillRecipeCounts, {})
    await t.finishAllScheduledFunctions(() => {})

    // The aggregate knows nothing about which rows a query hits, so this branch must stay on the
    // search index whatever the backfill's state.
    const counts = await t.query(api.recipes.countsByType, {
      query: 'blanquette',
    })
    expect(counts.total).toBe(1)
    expect(counts.byType).toMatchObject({ plat: 1, dessert: 0 })
  })
})
