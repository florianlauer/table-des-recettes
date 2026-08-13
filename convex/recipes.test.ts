import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { withSearchText } from './lib/recipeWrites'

const base = {
  status: 'published' as const,
  publishedAt: 1,
  beautifiedAccepted: false,
  beautifyStatus: 'idle' as const,
  ingredientsInferred: false,
  steps: ['Étape unique.'],
}

async function withRecipes() {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    // `searchText` goes through `withSearchText`, never written by hand: a pre-stemmed fixture
    // would keep these tests green if the write boundary stopped normalising ingredients —
    // which is exactly what they are supposed to certify.
    await ctx.db.insert(
      'recipes',
      withSearchText({
        ...base,
        title: 'Gratin de courgettes',
        slug: 'gratin-de-courgettes',
        type: 'plat',
        ingredients: [{ raw: '3 courgettes' }],
      }),
    )
    await ctx.db.insert(
      'recipes',
      withSearchText({
        ...base,
        title: 'Riz au lait',
        slug: 'riz-au-lait',
        type: 'dessert',
        ingredients: [{ raw: '200 g de riz rond' }],
      }),
    )
    await ctx.db.insert(
      'recipes',
      withSearchText({
        ...base,
        status: 'review',
        title: 'Brouillon non publié',
        type: 'plat',
        ingredients: [{ raw: '1 courgette' }],
      }),
    )
  })
  return t
}

test('browse excludes drafts', async () => {
  const t = await withRecipes()
  const rows = await t.query(api.recipes.browse, {})
  expect(rows).toHaveLength(2)
  expect(rows.map((r) => r.title)).not.toContain('Brouillon non publié')
})

test('browse filters by type', async () => {
  const t = await withRecipes()
  const rows = await t.query(api.recipes.browse, { type: 'dessert' })
  expect(rows).toHaveLength(1)
  expect(rows[0]?.title).toBe('Riz au lait')
})

test('browse without a query still returns the reason field, as null', async () => {
  const t = await withRecipes()
  const rows = await t.query(api.recipes.browse, {})
  expect(rows.every((r) => r.matchedIngredient === null)).toBe(true)
})

test('countsByType counts only published recipes and covers every type', async () => {
  const t = await withRecipes()
  const counts = await t.query(api.recipes.countsByType, {})
  expect(counts.total).toBe(2)
  expect(counts.byType.plat).toBe(1)
  expect(counts.byType.dessert).toBe(1)
  expect(counts.byType.apero).toBe(0)
  expect(counts.byType.petitDej).toBe(0)
})

test('countsByType counts the matches when a query is given', async () => {
  const t = await withRecipes()
  // What the filter row promises has to be what clicking it produces: unscoped, this said "1 dessert"
  // beside a search that no dessert answers.
  const counts = await t.query(api.recipes.countsByType, {
    query: 'courgettes',
  })
  expect(counts.total).toBe(1)
  expect(counts.byType.plat).toBe(1)
  expect(counts.byType.dessert).toBe(0)
})

test('countsByType treats a blank query as no query at all', async () => {
  const t = await withRecipes()
  expect(await t.query(api.recipes.countsByType, { query: '   ' })).toEqual(
    await t.query(api.recipes.countsByType, {}),
  )
})

test('getBySlug returns the published recipe', async () => {
  const t = await withRecipes()
  const recipe = await t.query(api.recipes.getBySlug, { slug: 'riz-au-lait' })
  expect(recipe?.title).toBe('Riz au lait')
})

test('getBySlug returns null for an unknown slug', async () => {
  const t = await withRecipes()
  expect(
    await t.query(api.recipes.getBySlug, { slug: 'inexistant' }),
  ).toBeNull()
})

test('a plural query finds the indexed singular, and the title is explanation enough', async () => {
  const t = await withRecipes()
  const rows = await t.query(api.recipes.browse, { query: 'courgettes' })
  expect(rows).toHaveLength(1)
  expect(rows[0]?.title).toBe('Gratin de courgettes')
  expect(rows[0]?.matchedIngredient).toBeNull()
})

test('searching an ingredient absent from the title surfaces that line', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    await ctx.db.insert(
      'recipes',
      withSearchText({
        ...base,
        title: 'Gratin du jardin',
        slug: 'gratin-du-jardin',
        type: 'plat',
        ingredients: [{ raw: '3 courgettes' }],
      }),
    )
  })
  // Singular query against a plural ingredient: only the canonical write makes this match
  // possible, on both sides of the boundary.
  const rows = await t.query(api.recipes.browse, { query: 'courgette' })
  expect(rows[0]?.matchedIngredient).toBe('3 courgettes')
})

test('an empty query lists everything instead of returning nothing', async () => {
  const t = await withRecipes()
  expect(await t.query(api.recipes.browse, { query: '   ' })).toHaveLength(2)
})

test('a published recipe without a slug throws instead of degrading', async () => {
  const t = convexTest(schema)
  await t.run(async (ctx) => {
    // The only fixture inserted outside the boundary: it deliberately builds the broken invariant.
    await ctx.db.insert('recipes', {
      ...base,
      title: 'Invariant rompu',
      type: 'plat',
      ingredients: [],
      searchText: 'invariant rompu',
    })
  })
  await expect(t.query(api.recipes.browse, {})).rejects.toThrow(/sans slug/)
})

const IMAGE_MODULES = import.meta.glob('./**/*.ts')

async function published(
  t: ReturnType<typeof convexTest>,
  over: Record<string, unknown>,
) {
  await t.run((ctx) =>
    ctx.db.insert(
      'recipes',
      withSearchText({
        ...base,
        title: 'Clafoutis',
        slug: 'clafoutis',
        type: 'dessert' as const,
        ingredients: [],
        ...over,
      }),
    ),
  )
}

/** Asserted on the whole array rather than on `rows[0]`: indexing is what needs a guard. */
async function expectOnlyRow(
  t: ReturnType<typeof convexTest>,
  image: {
    imageUrl: string | null
    imageWidth: number | null
    imageHeight: number | null
  },
) {
  expect(await t.query(api.recipes.browse, {})).toMatchObject([image])
}

async function storedBlob(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([1])], { type: 'image/webp' })),
  )
}

test('browse serves the display derivative and its intrinsic dimensions', async () => {
  const t = convexTest(schema, IMAGE_MODULES)
  const source = await storedBlob(t)
  const derivative = await storedBlob(t)
  await published(t, {
    imageStorageId: source,
    hasIllustration: true,
    imageRendition: {
      status: 'ready' as const,
      sourceStorageId: source,
      sourceWidth: 864,
      sourceHeight: 1184,
      storageId: derivative,
      width: 292,
      height: 400,
    },
  })

  await expectOnlyRow(t, {
    imageUrl: await t.run((ctx) => ctx.storage.getUrl(derivative)),
    imageWidth: 292,
    imageHeight: 400,
  })
})

// Correct rendering, degraded budget — and the admin work list is what reports it. Serving 1.9 MB
// while nobody is told is how the bandwidth quota goes.
test('browse falls back to the source, without dimensions, when no derivative is usable', async () => {
  const t = convexTest(schema, IMAGE_MODULES)
  const source = await storedBlob(t)
  await published(t, { imageStorageId: source, hasIllustration: true })

  await expectOnlyRow(t, {
    imageUrl: await t.run((ctx) => ctx.storage.getUrl(source)),
    imageWidth: null,
    imageHeight: null,
  })
})

// The compare-and-set that makes a missed cleanup harmless: a stale rendition must never be served
// as if it described the photo the recipe now holds.
test('browse ignores a rendition whose source no longer matches the slot', async () => {
  const t = convexTest(schema, IMAGE_MODULES)
  const oldSource = await storedBlob(t)
  const newSource = await storedBlob(t)
  const staleDerivative = await storedBlob(t)
  await published(t, {
    imageStorageId: newSource,
    hasIllustration: true,
    imageRendition: {
      status: 'ready' as const,
      sourceStorageId: oldSource,
      sourceWidth: 864,
      sourceHeight: 1184,
      storageId: staleDerivative,
      width: 292,
      height: 400,
    },
  })

  await expectOnlyRow(t, {
    imageUrl: await t.run((ctx) => ctx.storage.getUrl(newSource)),
    imageWidth: null,
    imageHeight: null,
  })
})

test('browse serves the beautified derivative once the candidate is accepted', async () => {
  const t = convexTest(schema, IMAGE_MODULES)
  const source = await storedBlob(t)
  const candidate = await storedBlob(t)
  const candidateDerivative = await storedBlob(t)
  await published(t, {
    imageStorageId: source,
    beautifiedStorageId: candidate,
    beautifiedAccepted: true,
    hasIllustration: true,
    beautifiedRendition: {
      status: 'ready' as const,
      sourceStorageId: candidate,
      sourceWidth: 1184,
      sourceHeight: 864,
      storageId: candidateDerivative,
      width: 548,
      height: 400,
    },
  })

  await expectOnlyRow(t, {
    imageUrl: await t.run((ctx) => ctx.storage.getUrl(candidateDerivative)),
    imageWidth: 548,
    imageHeight: 400,
  })
})
