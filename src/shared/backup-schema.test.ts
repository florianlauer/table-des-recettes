import { describe, expect, test } from 'vitest'
import { backupRecipeSchema, restorableProjection } from './backup-schema'
import { completeBackupRecipe } from './backup-schema.fixture'

describe('backup recipe schema', () => {
  test('accepts a complete backup recipe', () => {
    expect(backupRecipeSchema.parse(completeBackupRecipe)).toEqual(
      completeBackupRecipe,
    )
  })

  test('rejects an extra field', () => {
    expect(() =>
      backupRecipeSchema.parse({
        ...completeBackupRecipe,
        searchText: 'extra',
      }),
    ).toThrow()
  })

  test('rejects an absent nullable field', () => {
    const { slug: _slug, ...withoutSlug } = completeBackupRecipe
    expect(() => backupRecipeSchema.parse(withoutSlug)).toThrow()
  })

  test('projects storage references out of restorable data', () => {
    expect(restorableProjection(completeBackupRecipe)).toEqual({
      ...completeBackupRecipe,
      imageStorageId: null,
      beautifiedStorageId: null,
    })
  })
})
