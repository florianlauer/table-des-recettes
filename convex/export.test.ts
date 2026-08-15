/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import { z } from 'zod'
import { backupRecipeSchema } from '../src/shared/backup-schema'
import { internal } from './_generated/api'
import schema from './schema'
import { registerComponents } from '../test/convexComponents'

const modules = import.meta.glob('./**/*.ts')

test('backupPayload exports drafts and published recipes with nullable fields', async () => {
  const t = convexTest(schema, modules)
  registerComponents(t)
  await t.run(async (ctx) => {
    for (const status of ['published', 'review'] as const) {
      await ctx.db.insert('recipes', {
        title: status,
        type: 'plat',
        ingredients: [{ raw: '1 courgette' }],
        ingredientsInferred: false,
        steps: ['Cook.'],
        searchText: status,
        status,
        beautifiedAccepted: false,
        beautifyStatus: 'idle',
      })
    }
  })

  const recipes = await t.query(internal.export.backupPayload, {})
  // The backup shape is written four times — this Zod schema, the Convex validator, the query
  // projection and its inverse in the restore script. `strictObject` makes this the assertion that
  // catches a field missing on one side or surplus on the other, in both directions.
  expect(() => z.array(backupRecipeSchema).parse(recipes)).not.toThrow()
  expect(recipes.map(({ status }) => status).sort()).toEqual([
    'published',
    'review',
  ])
  expect(recipes.map(({ id }) => id)).toEqual(
    recipes.map(({ id }) => id).sort(),
  )
  expect(recipes[0]).toMatchObject({
    servings: null,
    slug: null,
    publishedAt: null,
    imageStorageId: null,
    beautifiedStorageId: null,
    ingredients: [
      { raw: '1 courgette', quantity: null, unit: null, label: null },
    ],
  })
})
