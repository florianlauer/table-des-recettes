import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { countPublishedByType, publishedRecipes } from './recipeCounts'
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

async function newScan(t: Harness) {
  const ticket = await t.mutation(api.admin.generateUploadUrl, { adminToken })
  if (!ticket.ok) throw new Error(ticket.error)
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['image'], { type: 'image/jpeg' })),
  )
  const scan = await t.mutation(api.admin.attachImage, {
    adminToken,
    ticketId: ticket.ticketId,
    storageId,
  })
  if (!scan.ok) throw new Error(scan.error)
  return scan.scanId
}

async function draft(
  t: Harness,
  scanId: Id<'scans'>,
  title: string,
  type: RecipeType = 'dessert',
) {
  const added = await t.mutation(api.recipeAdmin.addRecipe, {
    adminToken,
    scanId,
  })
  if (!added.ok) throw new Error(added.error)
  await save(t, added.recipeId, title, type)
  return added.recipeId
}

async function save(
  t: Harness,
  recipeId: Id<'recipes'>,
  title: string,
  type: RecipeType,
) {
  const recipe = await t.run((ctx) => ctx.db.get('recipes', recipeId))
  const saved = await t.mutation(api.recipeAdmin.saveRecipe, {
    adminToken,
    recipeId,
    expectedRevision: recipe?.revision ?? 0,
    title,
    type,
    ingredients: [{ raw: '4 pommes', quantity: 4, label: 'pommes' }],
    ingredientsInferred: false,
    steps: ['Cuire.'],
  })
  if (!saved.ok) throw new Error(saved.error)
}

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

/**
 * The invariant the whole component rests on, asserted after every gesture rather than at the end: a
 * count that drifts and then drifts back would pass an end-state check.
 *
 * Compared over all twelve namespaces, not only the six the storefront reads: a draft the aggregate
 * still holds after its row is gone is invisible to `countPublishedByType` and becomes a wrong
 * public count the day that recipe's slot gets published again.
 */
async function expectAggregateMatchesTable(t: Harness) {
  const namespaces = (['review', 'published'] as const).flatMap((status) =>
    RECIPE_TYPES.map((type) => `${status}:${type}`),
  )
  const [aggregate, table] = await t.run(async (ctx) => {
    const counted = await publishedRecipes.countBatch(
      ctx,
      namespaces.map((namespace) => ({ namespace })),
    )
    const fromTable: Record<string, number> = Object.fromEntries(
      namespaces.map((key) => [key, 0]),
    )
    for (const row of await ctx.db.query('recipes').collect()) {
      const key = `${row.status}:${row.type}`
      fromTable[key] = (fromTable[key] ?? 0) + 1
    }
    return [
      Object.fromEntries(
        namespaces.map((key, index) => [key, counted[index] ?? 0]),
      ),
      fromTable,
    ]
  })
  expect(aggregate).toEqual(table)
}

describe('the aggregate follows the table through every gesture', () => {
  test('publishing, retyping, unpublishing and deleting all keep it in step', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Clafoutis aux cerises')
    // A draft counts nowhere on the storefront, but it does occupy `review:dessert`: publishing is a
    // move between namespaces, not an insert.
    await expectAggregateMatchesTable(t)

    expect(
      await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId }),
    ).toEqual({ ok: true })
    await expectAggregateMatchesTable(t)
    expect((await scanned(t)).byType.dessert).toBe(1)

    // A retype while published: same status, different namespace. This is the write that a
    // status-only aggregate would have missed.
    await save(t, recipeId, 'Clafoutis aux cerises', 'plat')
    await expectAggregateMatchesTable(t)
    expect((await scanned(t)).byType).toMatchObject({ dessert: 0, plat: 1 })

    expect(
      await t.mutation(api.recipeAdmin.unpublishRecipe, {
        adminToken,
        recipeId,
      }),
    ).toEqual({ ok: true })
    await expectAggregateMatchesTable(t)
    expect((await scanned(t)).total).toBe(0)

    expect(
      await t.mutation(api.recipeAdmin.deleteRecipe, { adminToken, recipeId }),
    ).toEqual({ ok: true })
    await expectAggregateMatchesTable(t)
  })

  // `rescan` drops a scan's drafts in bulk before requeueing it. It deletes rows the aggregate holds
  // in a `review:*` namespace, so it is a write site like any other.
  test('rescan drops the drafts without leaving phantoms behind', async () => {
    const t = setup()
    // The survivor lives on its own scan: `rescan` refuses outright when one of the scan's own
    // recipes is published.
    const kept = await draft(t, await newScan(t), 'Tarte fine', 'dessert')
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: kept,
    })
    const scanId = await newScan(t)
    await draft(t, scanId, 'Brouillon à jeter', 'plat')
    await draft(t, scanId, 'Autre brouillon', 'entree')

    expect(await t.mutation(api.admin.rescan, { adminToken, scanId })).toEqual({
      ok: true,
    })
    await expectAggregateMatchesTable(t)
    // Not everything got wiped — which is what makes the line above an assertion rather than a
    // tautology over an empty table.
    expect((await scanned(t)).byType.dessert).toBe(1)
  })
})

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

/**
 * `status` and `type` are the two fields the aggregate is namespaced on, and a write that changes
 * either without telling it leaves a count that no later gesture repairs — `deleteIfExists` looks in
 * the namespace the *current* document names, so a missed status change turns into a permanent
 * phantom. Two write sites were already doing exactly that when this was written.
 *
 * Hence a source scan rather than a behavioural test: the risk is the write site nobody thought to
 * cover.
 */
describe('the single-writer inventory', () => {
  const CONVEX_DIR = fileURLToPath(new URL('.', import.meta.url))
  const WRITERS = 'recipeCounts.ts'

  function modulesOf(): Array<{ name: string; source: string }> {
    return readdirSync(CONVEX_DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => name !== WRITERS)
      .map((name) => ({
        name,
        source: readFileSync(`${CONVEX_DIR}${name}`, 'utf8'),
      }))
  }

  /** Every `ctx.db.<method>(…)` call in a module, argument list included, parens balanced. */
  function dbCalls(source: string, method: string): Array<string> {
    const marker = `db.${method}(`
    const calls: Array<string> = []
    let cursor = source.indexOf(marker)
    while (cursor !== -1) {
      let depth = 0
      let index = cursor + marker.length - 1
      do {
        if (source[index] === '(') depth += 1
        if (source[index] === ')') depth -= 1
        index += 1
      } while (depth > 0 && index < source.length)
      calls.push(source.slice(cursor, index))
      cursor = source.indexOf(marker, index)
    }
    return calls
  }

  test('nothing but recipeCounts.ts inserts into recipes', () => {
    for (const { name, source } of modulesOf()) {
      for (const call of dbCalls(source, 'insert')) {
        expect(call, name).not.toContain("'recipes'")
      }
    }
  })

  /**
   * A delete takes an id, so nothing in the call text names the table. The inventory is therefore an
   * allowlist: every direct `db.delete` outside `recipeCounts.ts`, with the table it targets. A new
   * one fails here, which is the point — the author has to come and say which table it deletes from.
   */
  test('every direct delete outside recipeCounts.ts is accounted for', () => {
    const expected: Record<string, Array<string>> = {
      // Expired upload tickets. Not a recipe, and the aggregate never sees them.
      'extract.ts': ['db.delete(ticket._id)'],
    }
    const found = Object.fromEntries(
      modulesOf()
        .map(({ name, source }) => [name, dbCalls(source, 'delete')] as const)
        .filter(([, calls]) => calls.length > 0),
    )
    expect(found).toEqual(expected)
  })

  test('nothing but recipeCounts.ts patches status or type', () => {
    for (const { name, source } of modulesOf()) {
      for (const call of dbCalls(source, 'patch')) {
        // Scoped to the two recipe statuses: `scans` and the rendition slots carry a `status` of
        // their own, and the aggregate is indifferent to those.
        expect(call, name).not.toMatch(/\bstatus:\s*'(published|review)'/)
        expect(call, name).not.toMatch(/\btype:/)
      }
    }
  })
})
