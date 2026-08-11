import { z } from 'zod'
import { RECIPE_TYPES } from './recipeTypes.js'

export const BACKUP_FORMAT_VERSION = '1'

const nullableString = z.string().nullable()
const nullableNumber = z.number().nullable()

export const backupRecipeSchema = z.strictObject({
  id: z.string(),
  creationTime: z.number(),
  title: z.string(),
  type: z.enum(RECIPE_TYPES),
  servings: nullableNumber,
  ingredients: z.array(
    z.strictObject({
      raw: z.string(),
      quantity: nullableNumber,
      unit: nullableString,
      label: nullableString,
    }),
  ),
  ingredientsInferred: z.boolean(),
  steps: z.array(z.string()),
  status: z.enum(['review', 'published']),
  slug: nullableString,
  publishedAt: nullableNumber,
  imageStorageId: nullableString,
  beautifiedStorageId: nullableString,
})

export const backupManifestSchema = z.strictObject({
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  generatedAt: z.iso.datetime(),
  total: z.number().int().nonnegative(),
  countsByStatus: z.strictObject({
    review: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
  }),
})

export type BackupRecipe = z.infer<typeof backupRecipeSchema>
export type BackupManifest = z.infer<typeof backupManifestSchema>

export function compareBackupIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function restorableProjection({
  id,
  creationTime,
  title,
  type,
  servings,
  ingredients,
  ingredientsInferred,
  steps,
  status,
  slug,
  publishedAt,
}: BackupRecipe): BackupRecipe {
  return backupRecipeSchema.parse({
    id,
    creationTime,
    title,
    type,
    servings,
    ingredients,
    ingredientsInferred,
    steps,
    status,
    slug,
    publishedAt,
    imageStorageId: null,
    beautifiedStorageId: null,
  })
}
