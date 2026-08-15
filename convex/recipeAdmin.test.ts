import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { RETENTION_AFTER_TREATMENT_MS } from './retention'
import { SLUG_PROBE_LIMIT } from '../src/shared/scanLimits'
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

async function draft(t: Harness, scanId: Id<'scans'>, title: string) {
  const added = await t.mutation(api.recipeAdmin.addRecipe, {
    adminToken,
    scanId,
  })
  if (!added.ok) throw new Error(added.error)
  const saved = await t.mutation(api.recipeAdmin.saveRecipe, {
    adminToken,
    recipeId: added.recipeId,
    expectedRevision: 0,
    title,
    type: 'dessert',
    ingredients: [{ raw: '4 pommes', quantity: 4, label: 'pommes' }],
    ingredientsInferred: false,
    steps: ['Cuire.'],
  })
  if (!saved.ok) throw new Error(saved.error)
  return added.recipeId
}

const read = (t: Harness, recipeId: Id<'recipes'>) =>
  t.run((ctx) => ctx.db.get('recipes', recipeId))

describe('editing a draft', () => {
  test('derives the search text on every write', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Crêpes de sarrasin')
    // Title and ingredients folded together, accents and plurals removed: the pair has to cross
    // `withSearchText` on every write or the recipe stops being findable, silently.
    expect(await read(t, recipeId)).toMatchObject({
      searchText: 'crepe de sarrasin 4 pomme',
      revision: 1,
    })
  })

  test('refuses a save built on a stale revision', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Première version')
    const fields = {
      adminToken,
      recipeId,
      title: 'Deuxième onglet',
      type: 'plat' as const,
      ingredients: [],
      ingredientsInferred: false,
      steps: [],
    }

    await expect(
      t.mutation(api.recipeAdmin.saveRecipe, {
        ...fields,
        expectedRevision: 0,
      }),
    ).resolves.toMatchObject({ ok: false })
    // The corrections of the tab that did save are still there.
    expect(await read(t, recipeId)).toMatchObject({ title: 'Première version' })
  })

  test('refuses to strip the title of a published recipe', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Tarte aux pommes')
    await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId })

    // Publication invariants apply to every later edit too: an emptied title would keep its slug
    // and stay online with content publication would have refused.
    await expect(
      t.mutation(api.recipeAdmin.saveRecipe, {
        adminToken,
        recipeId,
        expectedRevision: 2,
        title: '!!!',
        type: 'dessert',
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'Une recette publiée doit garder un titre : dépublie-la d’abord',
    })
  })
})

describe('publishing', () => {
  test('freezes a slug and never recomputes it', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Tarte aux pommes')

    await expect(
      t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
    expect(await read(t, recipeId)).toMatchObject({
      status: 'published',
      slug: 'tarte-aux-pommes',
    })

    await t.mutation(api.recipeAdmin.saveRecipe, {
      adminToken,
      recipeId,
      expectedRevision: 2,
      title: 'Tarte aux poires',
      type: 'dessert',
      ingredients: [],
      ingredientsInferred: false,
      steps: [],
    })
    await t.mutation(api.recipeAdmin.unpublishRecipe, { adminToken, recipeId })
    await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId })
    // The storefront handed this address out; a renamed recipe must not move it.
    expect(await read(t, recipeId)).toMatchObject({ slug: 'tarte-aux-pommes' })
  })

  test('avoids the slug of an unpublished recipe', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const first = await draft(t, scanId, 'Tarte aux pommes')
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: first,
    })
    await t.mutation(api.recipeAdmin.unpublishRecipe, {
      adminToken,
      recipeId: first,
    })

    const second = await draft(t, scanId, 'Tarte aux pommes')
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: second,
    })
    expect(await read(t, second)).toMatchObject({ slug: 'tarte-aux-pommes-2' })
  })

  test('falls back to the recipe id past the probe ceiling', async () => {
    const t = setup()
    const scanId = await newScan(t)
    await t.run(async (ctx) => {
      for (let suffix = 1; suffix <= SLUG_PROBE_LIMIT; suffix += 1) {
        await ctx.db.insert('recipes', {
          title: 'Homonyme',
          type: 'autre',
          ingredients: [],
          ingredientsInferred: false,
          steps: [],
          searchText: 'homonyme',
          status: 'published',
          slug: suffix === 1 ? 'homonyme' : `homonyme-${suffix}`,
          beautifiedAccepted: false,
          beautifyStatus: 'idle',
        })
      }
    })

    const recipeId = await draft(t, scanId, 'Homonyme')
    await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId })
    expect(await read(t, recipeId)).toMatchObject({
      slug: `homonyme-${recipeId}`,
    })
  })

  test('refuses a title that yields no slug', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, '!!!')
    await expect(
      t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId }),
    ).resolves.toMatchObject({ ok: false })
    expect(await read(t, recipeId)).toMatchObject({ status: 'review' })
  })

  test('blocks publication while the images have changed, and again once acknowledged', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Gratin')
    await t.run((ctx) =>
      ctx.db.patch(scanId, { status: 'done', imagesChangedAt: Date.now() }),
    )

    await expect(
      t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId }),
    ).resolves.toMatchObject({ ok: false })
    await t.mutation(api.recipeAdmin.acknowledgeImageChange, {
      adminToken,
      scanId,
    })
    await expect(
      t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
  })

  test('publishes a whole scan and names what it could not', async () => {
    const t = setup()
    const scanId = await newScan(t)
    await draft(t, scanId, 'Soupe de courge')
    await draft(t, scanId, '???')

    const result = await t.mutation(api.recipeAdmin.publishScan, {
      adminToken,
      scanId,
    })
    expect(result).toMatchObject({
      ok: true,
      published: 1,
      refused: [{ title: '???' }],
    })
  })

  test('handles a recipe with no parent scan', async () => {
    const t = setup()
    const recipeId = await t.run((ctx) =>
      ctx.db.insert('recipes', {
        title: 'Orpheline',
        type: 'autre',
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
        searchText: 'orpheline',
        status: 'review',
        beautifiedAccepted: false,
        beautifyStatus: 'idle',
      }),
    )

    await expect(
      t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
    await expect(
      t.mutation(api.recipeAdmin.unpublishRecipe, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
    await expect(
      t.mutation(api.recipeAdmin.deleteRecipe, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
  })
})

describe('deleting', () => {
  test('refuses a published recipe until it is unpublished', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Blanquette')
    await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId })

    await expect(
      t.mutation(api.recipeAdmin.deleteRecipe, { adminToken, recipeId }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'Dépublie la recette avant de la supprimer',
    })
    await t.mutation(api.recipeAdmin.unpublishRecipe, { adminToken, recipeId })
    await expect(
      t.mutation(api.recipeAdmin.deleteRecipe, { adminToken, recipeId }),
    ).resolves.toEqual({ ok: true })
  })
})

describe('retention follows the drafts', () => {
  test('arms the purge on publication and disarms it on unpublication', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Tian de légumes')
    const longDeadline = (await t.run((ctx) => ctx.db.get('scans', scanId)))
      ?.purgeAfter

    await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId })
    const armed = await t.run((ctx) => ctx.db.get('scans', scanId))
    expect(armed?.purgeAfter).toBeLessThan(longDeadline ?? 0)
    expect(armed?.purgeAfter).toBeLessThanOrEqual(
      Date.now() + RETENTION_AFTER_TREATMENT_MS,
    )

    await t.mutation(api.recipeAdmin.unpublishRecipe, { adminToken, recipeId })
    // Correctable again means the photo is needed again — the case a one-way lowering could not undo.
    expect(
      (await t.run((ctx) => ctx.db.get('scans', scanId)))?.purgeAfter,
    ).toBeGreaterThan(armed?.purgeAfter ?? 0)
  })

  test('does not arm the purge for a scan emptied of its recipes', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Faux positif')
    const before = (await t.run((ctx) => ctx.db.get('scans', scanId)))
      ?.purgeAfter

    await t.mutation(api.recipeAdmin.deleteRecipe, { adminToken, recipeId })
    // A scan with nothing left is a failed scan, not a treated one: its photo is what would let it
    // be salvaged.
    expect(
      (await t.run((ctx) => ctx.db.get('scans', scanId)))?.purgeAfter,
    ).toBeGreaterThanOrEqual(before ?? 0)
  })
})
