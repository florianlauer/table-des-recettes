// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
  assertNonEmpty,
  assertPruneAllowed,
  createBackupPlan,
  recipeBackupFileNames,
  recipeFileName,
  requireBackupEnvironment,
  serializeBackupRecipe,
} from './backup'
import { BACKUP_FORMAT_VERSION } from '../src/shared/backup-schema'
import { completeBackupRecipe } from '../src/shared/backup-schema.fixture'
import type { BackupRecipe } from '../src/shared/backup-schema'

function recipe({
  id,
  slug,
}: {
  id: string
  slug: string | null
}): BackupRecipe {
  return { ...completeBackupRecipe, id, slug }
}

function payload(recipes: BackupRecipe[]) {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    generatedAt: '2026-08-11T03:00:00.000Z',
    recipes,
  }
}

describe('backup file naming', () => {
  test.each([
    ['Crème brûlée', 'creme-brulee.json'],
    ['two words', 'two-words.json'],
    ['folder/name', 'folder-name.json'],
    ['..', 'recipe-id.json'],
    ['', 'recipe-id.json'],
    ['LAST_RUN', 'recipe-id.json'],
    [null, 'recipe-id.json'],
  ])('maps slug %s to %s', (slug, expected) => {
    expect(recipeFileName({ id: 'recipe-id', slug })).toBe(expected)
  })

  test('rejects two recipes mapped to the same file and names both ids', () => {
    expect(() =>
      createBackupPlan({
        payload: payload([
          recipe({ id: 'first-id', slug: 'same' }),
          recipe({ id: 'second-id', slug: 'same' }),
        ]),
        existingFileNames: [],
        existingContents: new Map(),
        allowPrune: false,
      }),
    ).toThrow(/first-id.*second-id/)
  })
})

describe('backup guard rails', () => {
  test('names a missing endpoint URL during preflight', () => {
    expect(() =>
      requireBackupEnvironment({ url: undefined, token: 'token' }),
    ).toThrow(/CONVEX_BACKUP_URL/)
  })

  test('names a missing token during preflight', () => {
    expect(() =>
      requireBackupEnvironment({
        url: 'https://example.test',
        token: undefined,
      }),
    ).toThrow(/BACKUP_TOKEN/)
  })

  test('rejects an empty recipe list', () => {
    expect(() => assertNonEmpty([])).toThrow(/zero recipes/)
  })

  test('allows a 19 percent prune', () => {
    expect(() =>
      assertPruneAllowed({
        deletionCount: 19,
        existingRecipeCount: 100,
        allowPrune: false,
      }),
    ).not.toThrow()
  })

  test('rejects a 21 percent prune', () => {
    expect(() =>
      assertPruneAllowed({
        deletionCount: 21,
        existingRecipeCount: 100,
        allowPrune: false,
      }),
    ).toThrow(/exceeds 20%/)
  })

  test('allows a large prune with the explicit override', () => {
    expect(() =>
      assertPruneAllowed({
        deletionCount: 100,
        existingRecipeCount: 100,
        allowPrune: true,
      }),
    ).not.toThrow()
  })

  test('never treats the manifest as a recipe file', () => {
    expect(
      recipeBackupFileNames(['one.json', 'LAST_RUN.json', 'README.md']),
    ).toEqual(['one.json'])
    const plan = createBackupPlan({
      payload: payload([recipe({ id: 'one', slug: 'one' })]),
      existingFileNames: ['one.json', 'LAST_RUN.json'],
      existingContents: new Map([
        ['one.json', serializeBackupRecipe(recipe({ id: 'one', slug: 'one' }))],
      ]),
      allowPrune: false,
    })
    expect(plan.deletions).toEqual([])
  })

  test('rejects an unknown payload format version', () => {
    expect(() =>
      createBackupPlan({
        payload: { ...payload([completeBackupRecipe]), formatVersion: '2' },
        existingFileNames: [],
        existingContents: new Map(),
        allowPrune: false,
      }),
    ).toThrow()
  })
})

describe('backup serialization', () => {
  test('is byte-stable and independent from input key order', () => {
    const reordered = {
      beautifiedStorageId: completeBackupRecipe.beautifiedStorageId,
      imageStorageId: completeBackupRecipe.imageStorageId,
      publishedAt: completeBackupRecipe.publishedAt,
      slug: completeBackupRecipe.slug,
      status: completeBackupRecipe.status,
      steps: completeBackupRecipe.steps,
      ingredientsInferred: completeBackupRecipe.ingredientsInferred,
      ingredients: completeBackupRecipe.ingredients,
      servings: completeBackupRecipe.servings,
      type: completeBackupRecipe.type,
      title: completeBackupRecipe.title,
      creationTime: completeBackupRecipe.creationTime,
      id: completeBackupRecipe.id,
    }
    expect(serializeBackupRecipe(reordered)).toBe(
      serializeBackupRecipe(completeBackupRecipe),
    )
    expect(serializeBackupRecipe(completeBackupRecipe)).toBe(
      serializeBackupRecipe(completeBackupRecipe),
    )
  })
})
