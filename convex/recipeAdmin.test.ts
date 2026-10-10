import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { api, internal } from './_generated/api'
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
    //
    // `titleKey` is the second thing that write derives, and it is not the same fold: the title
    // alone, unstemmed, so it means « the same title » where `searchText` means « findable by ».
    // Asserted together because they have one writer and one chance to drift.
    expect(await read(t, recipeId)).toMatchObject({
      searchText: 'crepe de sarrasin 4 pomme',
      titleKey: 'crepes-de-sarrasin',
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

describe('a title already scanned', () => {
  const duplicateOf = async (
    t: Harness,
    scanId: Id<'scans'>,
    recipeId: Id<'recipes'>,
  ) => {
    const scan = await t.query(api.admin.getScanForCorrection, {
      adminToken,
      scanId,
    })
    return scan?.recipes.find((recipe) => recipe.id === recipeId)?.duplicateOf
  }

  test('warns on two drafts of the same page, neither ever published', async () => {
    const t = setup()
    const first = await newScan(t)
    const firstDraft = await draft(t, first, 'Soupe de courge')
    const second = await newScan(t)
    const secondDraft = await draft(t, second, 'Soupe de courge')

    // The case the screen exists for, and the one the slug could not see: a slug is minted at
    // publication, so neither draft had one and neither was warned — while « Tout publier » put
    // both on the shelf without asking anything.
    expect(await duplicateOf(t, second, secondDraft)).toMatchObject({
      title: 'Soupe de courge',
      status: 'review',
      slug: null,
      scanId: first,
    })
    // Symmetrical, deliberately: whichever of the two the operator opens first says so.
    expect(await duplicateOf(t, first, firstDraft)).toMatchObject({
      status: 'review',
    })
  })

  test('names the published recipe a draft would duplicate', async () => {
    const t = setup()
    const first = await newScan(t)
    const online = await draft(t, first, 'Tarte Tatin')
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: online,
    })

    // Accents and case fold into the same key, which is the whole reason the oracle is the folded
    // title and not the raw string: « TARTE TATIN » is not a second recipe.
    const second = await newScan(t)
    const shouted = await draft(t, second, 'TARTE TATIN')
    expect(await duplicateOf(t, second, shouted)).toEqual({
      title: 'Tarte Tatin',
      status: 'published',
      slug: 'tarte-tatin',
      scanId: first,
    })
  })

  test('does not mistake a numbered title for a collision suffix', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const numbered = await draft(t, scanId, 'Gateau 2')
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: numbered,
    })

    // « Gateau 2 » publishes to the slug `gateau-2`, which is also what a second « Gateau » would
    // be given. Walking the slug family therefore reported « Gateau 2 » as a homonym of « Gateau ».
    // The folded title cannot conflate the two: `gateau` and `gateau-2` are different keys.
    const plain = await draft(t, scanId, 'Gateau')
    expect(await duplicateOf(t, scanId, plain)).toBeNull()
  })

  test('reports a twin taken offline as being in review, not online', async () => {
    const t = setup()
    const first = await newScan(t)
    const recipeId = await draft(t, first, 'Clafoutis')
    await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId })
    // The slug survives unpublication (ADR 0001), so it is still there to be reported — but sending
    // the operator to a page the storefront no longer serves would be a dead link, which is why the
    // status, and not the presence of a slug, is what the form reads.
    await t.mutation(api.recipeAdmin.unpublishRecipe, { adminToken, recipeId })

    const second = await newScan(t)
    const again = await draft(t, second, 'Clafoutis')
    expect(await duplicateOf(t, second, again)).toMatchObject({
      status: 'review',
      slug: 'clafoutis',
    })
  })

  test('stays silent for a lone draft and for a published recipe', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const alone = await draft(t, scanId, 'Blanquette')
    expect(await duplicateOf(t, scanId, alone)).toBeNull()

    // Once online the flag says nothing: it answers « publier ceci ferait un doublon », a question
    // an already published recipe has passed.
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: alone,
    })
    expect(await duplicateOf(t, scanId, alone)).toBeNull()
  })

  test('does not mistake a recipe for its own twin', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Ratatouille')
    await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId })
    await t.mutation(api.recipeAdmin.unpublishRecipe, { adminToken, recipeId })

    // Back in review and still the only holder of its key: the index answers with the recipe asking
    // the question, which is not a duplicate. `take(2)` is what makes that decidable.
    expect(await duplicateOf(t, scanId, recipeId)).toBeNull()
  })

  test('does not pair up two untitled drafts', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const first = await draft(t, scanId, '!!!')
    await draft(t, scanId, '???')

    // Both fold to the empty key. Matching on it would make every untitled draft the twin of every
    // other, and publication refuses these two anyway — so the empty key is not a title.
    expect(await duplicateOf(t, scanId, first)).toBeNull()
  })

  test('follows a title that is corrected', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const online = await draft(t, scanId, 'Gratin dauphinois')
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: online,
    })
    const other = await draft(t, scanId, 'Autre chose')
    expect(await duplicateOf(t, scanId, other)).toBeNull()

    // The key is derived on every write of the pair, never frozen like a slug: retyping the title
    // during correction is exactly how an operator discovers the recipe was already scanned.
    await t.mutation(api.recipeAdmin.saveRecipe, {
      adminToken,
      recipeId: other,
      expectedRevision: 1,
      title: 'Gratin dauphinois',
      type: 'plat',
      ingredients: [],
      ingredientsInferred: false,
      steps: [],
    })
    expect(await duplicateOf(t, scanId, other)).toMatchObject({
      title: 'Gratin dauphinois',
      status: 'published',
    })
  })

  test('names the published copy, not the oldest one', async () => {
    const t = setup()
    const scanId = await newScan(t)
    // Two drafts first, the published copy last — index order is creation order, so a single probe
    // on the key would return these two and report « attend en relecture » about a title that is on
    // the storefront. The `status` key of the index is what makes the published one findable first.
    const olderDraft = await draft(t, scanId, 'Chili')
    await draft(t, scanId, 'Chili')
    const online = await draft(t, scanId, 'Chili')
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: online,
    })

    expect(await duplicateOf(t, scanId, olderDraft)).toMatchObject({
      status: 'published',
      slug: 'chili',
    })
  })

  test('says nothing while the asking recipe is itself un-backfilled', async () => {
    const t = setup()
    const scanId = await newScan(t)
    // Two rows as they stand before the migration, sharing nothing but the absence of a key. Convex
    // indexes that absence, so without the `undefined` guard each would be handed the other as its
    // twin — an unrelated recipe, named with confidence, right in the deploy window.
    const asking = await t.run(async (ctx) => {
      const id = await ctx.db.insert('recipes', {
        scanId,
        title: 'Hachis parmentier',
        type: 'plat',
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
        searchText: 'hachi parmentier',
        status: 'review',
        beautifiedAccepted: false,
        beautifyStatus: 'idle',
      })
      await ctx.db.insert('recipes', {
        scanId,
        title: 'Pot-au-feu',
        type: 'plat',
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
        searchText: 'pot au feu',
        status: 'published',
        slug: 'pot-au-feu',
        beautifiedAccepted: false,
        beautifyStatus: 'idle',
      })
      return id
    })

    expect(await duplicateOf(t, scanId, asking)).toBeNull()
  })

  test('finds a recipe the backfill has reached, and nothing before that', async () => {
    const t = setup()
    const scanId = await newScan(t)
    // A row as it stands before the migration: written without `titleKey`, the way every recipe in
    // the corpus was. The absent field *is* indexed — it is the range `backfillTitleKey` walks — so
    // what keeps it out is the guard: matching on `undefined` would make every un-walked recipe the
    // twin of every other.
    const legacyId = await t.run((ctx) =>
      ctx.db.insert('recipes', {
        title: 'Pot-au-feu',
        type: 'plat',
        ingredients: [],
        ingredientsInferred: false,
        steps: [],
        searchText: 'pot au feu',
        status: 'published',
        slug: 'pot-au-feu',
        beautifiedAccepted: false,
        beautifyStatus: 'idle',
      }),
    )
    const fresh = await draft(t, scanId, 'Pot-au-feu')
    expect(await duplicateOf(t, scanId, fresh)).toBeNull()

    await t.run((ctx) => ctx.db.patch(legacyId, { titleKey: 'pot-au-feu' }))
    expect(await duplicateOf(t, scanId, fresh)).toMatchObject({
      title: 'Pot-au-feu',
      status: 'published',
    })
  })

  /**
   * The operator's own question: does the warning wait for a save? It must not — the screen opens on
   * what the extraction wrote, and that is the moment the answer is worth having.
   *
   * Which holds because `extract.finalize` inserts through `withSearchText` like every other title
   * write, so the key exists before anyone has typed anything. Asserted through the real
   * finalisation rather than through `draft`, whose `saveRecipe` would hide exactly the dependency
   * in question.
   */
  test('warns on a recipe straight out of the extraction, saved by nobody', async () => {
    const t = setup()
    const published = await newScan(t)
    const online = await draft(t, published, 'Blanquette de veau')
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: online,
    })

    const attemptId = 'scan:1:1'
    const scanId = await t.run(async (ctx) =>
      ctx.db.insert('scans', {
        imageStorageIds: [
          await ctx.storage.store(new Blob(['image'], { type: 'image/jpeg' })),
        ],
        status: 'extracting',
        attemptId,
        startedAt: Date.now(),
        attempts: 1,
        createdAt: Date.now(),
      }),
    )
    expect(
      await t.mutation(internal.extract.finalize, {
        scanId,
        attemptId,
        model: 'model',
        servedProvider: null,
        latencyMs: 10,
        costUsd: 0.01,
        repairCount: 0,
        recipes: [
          {
            title: 'Blanquette de veau',
            type: 'plat' as const,
            ingredients: [],
            ingredientsInferred: false,
            steps: [],
          },
        ],
      }),
    ).toBe(true)

    const scan = await t.query(api.admin.getScanForCorrection, {
      adminToken,
      scanId,
    })
    expect(scan?.recipes).toHaveLength(1)
    expect(scan?.recipes[0]?.duplicateOf).toMatchObject({
      title: 'Blanquette de veau',
      status: 'published',
      slug: 'blanquette-de-veau',
    })
  })
})

/**
 * `duplicateOf` answers about the title on file, which is silence for a title being typed — and a
 * recipe added by hand starts untitled, so that silence lasted until a first save. These are the same
 * oracle asked about a string instead of a row.
 */
describe('a title being typed', () => {
  const twinFor = (t: Harness, recipeId: Id<'recipes'>, title: string) =>
    t.query(api.admin.twinForTitle, { adminToken, recipeId, title })

  async function published(t: Harness, title: string) {
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, title)
    await t.mutation(api.recipeAdmin.publishRecipe, { adminToken, recipeId })
    return recipeId
  }

  test('warns before the title is saved, on a recipe added by hand', async () => {
    const t = setup()
    await published(t, 'Blanquette de veau')
    // Straight out of « Ajouter une recette »: no title, so no key, so nothing `duplicateOf` could
    // ever have reported. This is the case the question was about.
    const added = await t.mutation(api.recipeAdmin.addRecipe, {
      adminToken,
      scanId: await newScan(t),
    })
    if (!added.ok) throw new Error(added.error)

    expect(
      await twinFor(t, added.recipeId, 'blanquette de VEAU'),
    ).toMatchObject({
      title: 'Blanquette de veau',
      status: 'published',
      slug: 'blanquette-de-veau',
    })
    // The same recipe, mid-keystroke. A prefix is not the title, and a warning on one would fire on
    // every recipe whose name starts like another's.
    expect(await twinFor(t, added.recipeId, 'blanq')).toBeNull()
    expect(await twinFor(t, added.recipeId, '')).toBeNull()
  })

  test('never reports the recipe to itself', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const alone = await draft(t, scanId, 'Soupe au pistou')

    // Typing its own saved title back is the commonest edit there is — a corrected accent, an undone
    // keystroke — and it must not accuse the recipe of duplicating itself.
    expect(await twinFor(t, alone, 'Soupe au pistou')).toBeNull()
    expect(await twinFor(t, alone, 'Gratin de courgettes')).toBeNull()
  })

  test('says nothing once the recipe is published', async () => {
    const t = setup()
    const online = await published(t, 'Tarte aux pommes')
    await published(t, 'Poulet rôti')

    // Same gate as `duplicateOf`: the answer is about the act of publishing, and this recipe has
    // already been through it. Retitling it onto a taken title is a different problem — the slug is
    // what guards that one, at the write.
    expect(await twinFor(t, online, 'Poulet rôti')).toBeNull()
  })

  test('answers null for a recipe that no longer exists', async () => {
    const t = setup()
    await published(t, 'Ratatouille')
    const scanId = await newScan(t)
    const doomed = await draft(t, scanId, 'À jeter')
    await t.mutation(api.recipeAdmin.deleteRecipe, {
      adminToken,
      recipeId: doomed,
    })

    // A form left open while its row is deleted from another tab. The probe is a background
    // question; turning the screen into an error over it would be the wrong trade.
    expect(await twinFor(t, doomed, 'Ratatouille')).toBeNull()
  })

  test('refuses without the admin token', async () => {
    const t = setup()
    const scanId = await newScan(t)
    const recipeId = await draft(t, scanId, 'Chou farci')
    await expect(
      t.query(api.admin.twinForTitle, {
        adminToken: 'wrong',
        recipeId,
        title: 'Chou farci',
      }),
    ).rejects.toThrow()
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
