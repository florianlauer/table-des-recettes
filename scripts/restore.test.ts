// @vitest-environment node
import { mkdtemp, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import {
  assertManifestMatches,
  assertRestoredBackup,
  buildRestoreJsonl,
  canonicalDigest,
  convexImportArguments,
  convexRunArguments,
  parseRestoredRecipes,
  parseRestoreTarget,
  readRestoreSnapshot,
} from './restore'
import {
  BACKUP_FORMAT_VERSION,
  backupManifestSchema,
} from '../src/shared/backup-schema'
import { completeBackupRecipe } from '../src/shared/backup-schema.fixture'

const temporaryDirectories: string[] = []

async function temporaryBackup(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'backup-test-'))
  temporaryDirectories.push(directory)
  return directory
}

async function writeJson({
  directory,
  fileName,
  value,
}: {
  directory: string
  fileName: string
  value: unknown
}): Promise<void> {
  await writeFile(join(directory, fileName), `${JSON.stringify(value)}\n`)
}

function manifest({
  total = 1,
  review = 0,
  published = 1,
}: {
  total?: number
  review?: number
  published?: number
} = {}) {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    generatedAt: '2026-08-11T03:00:00.000Z',
    total,
    countsByStatus: { review, published },
  }
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    const files = await readdir(directory)
    await Promise.all(
      files.map((fileName) => unlink(join(directory, fileName))),
    )
    await rmdir(directory)
  }
})

describe('restore manifest', () => {
  test('rejects an absent manifest', async () => {
    const directory = await temporaryBackup()
    await expect(
      readRestoreSnapshot({ backupDirectory: directory }),
    ).rejects.toThrow(/LAST_RUN.json is missing/)
  })

  test('rejects an unknown format version before reading recipes', async () => {
    const directory = await temporaryBackup()
    await writeJson({
      directory,
      fileName: 'LAST_RUN.json',
      value: { ...manifest(), formatVersion: '2' },
    })
    await expect(
      readRestoreSnapshot({ backupDirectory: directory }),
    ).rejects.toThrow()
  })

  test('accepts the expected format version', async () => {
    const directory = await temporaryBackup()
    await Promise.all([
      writeJson({ directory, fileName: 'LAST_RUN.json', value: manifest() }),
      writeJson({
        directory,
        fileName: 'creme-brulee.json',
        value: completeBackupRecipe,
      }),
    ])
    await expect(
      readRestoreSnapshot({ backupDirectory: directory }),
    ).resolves.toEqual({
      manifest: backupManifestSchema.parse(manifest()),
      recipes: [completeBackupRecipe],
    })
  })

  test('rejects a missing recipe file', async () => {
    const directory = await temporaryBackup()
    await Promise.all([
      writeJson({
        directory,
        fileName: 'LAST_RUN.json',
        value: manifest({ total: 2, published: 2 }),
      }),
      writeJson({
        directory,
        fileName: 'creme-brulee.json',
        value: completeBackupRecipe,
      }),
    ])
    await expect(
      readRestoreSnapshot({ backupDirectory: directory }),
    ).rejects.toThrow(/manifest totals/)
  })

  test('rejects status counts that disagree with the files', () => {
    expect(() =>
      assertManifestMatches({
        manifest: backupManifestSchema.parse(
          manifest({ review: 1, published: 0 }),
        ),
        recipes: [completeBackupRecipe],
      }),
    ).toThrow(/manifest totals/)
  })
})

describe('restore JSONL', () => {
  test('rebuilds required fields, search text, and omits dangling references', () => {
    const jsonl = buildRestoreJsonl([completeBackupRecipe])
    const restored = JSON.parse(jsonl.trim()) as Record<string, unknown>
    expect(restored).toMatchObject({
      _id: completeBackupRecipe.id,
      _creationTime: completeBackupRecipe.creationTime,
      searchText: 'creme brulee 4 jaune d oeuf',
      beautifiedAccepted: false,
      beautifyStatus: 'idle',
    })
    expect(restored).not.toHaveProperty('scanId')
    expect(restored).not.toHaveProperty('imageStorageId')
    expect(restored).not.toHaveProperty('beautifiedStorageId')
  })

  test('produces identical JSONL on a second pass', () => {
    expect(buildRestoreJsonl([completeBackupRecipe])).toBe(
      buildRestoreJsonl([completeBackupRecipe]),
    )
  })
})

describe('post-import verification', () => {
  test('matches equal sets regardless of their order', () => {
    const draft = {
      ...completeBackupRecipe,
      id: 'draft-id',
      status: 'review' as const,
      slug: null,
    }
    const expected = [completeBackupRecipe, draft]
    const actual = [draft, completeBackupRecipe]
    expect(canonicalDigest(actual)).toBe(canonicalDigest(expected))
    expect(() =>
      assertRestoredBackup({
        expected,
        actual,
        manifest: backupManifestSchema.parse(
          manifest({ total: 2, review: 1, published: 1 }),
        ),
      }),
    ).not.toThrow()
  })

  test('rejects a changed title as a digest mismatch', () => {
    expect(() =>
      assertRestoredBackup({
        expected: [completeBackupRecipe],
        actual: [{ ...completeBackupRecipe, title: 'Changed title' }],
        manifest: backupManifestSchema.parse(manifest()),
      }),
    ).toThrow(/digest differs.*expected 1 recipes, actual 1 recipes/)
  })

  test('rejects a missing recipe as a count mismatch', () => {
    expect(() =>
      assertRestoredBackup({
        expected: [completeBackupRecipe],
        actual: [],
        manifest: backupManifestSchema.parse(manifest()),
      }),
    ).toThrow(/counts differ.*expected 1 recipes.*actual 0 recipes/)
  })

  test('ignores storage references that restoration cannot preserve', () => {
    const withoutStorage = {
      ...completeBackupRecipe,
      imageStorageId: null,
      beautifiedStorageId: null,
    }
    expect(canonicalDigest([withoutStorage])).toBe(
      canonicalDigest([completeBackupRecipe]),
    )
    expect(() =>
      assertRestoredBackup({
        expected: [completeBackupRecipe],
        actual: [withoutStorage],
        manifest: backupManifestSchema.parse(manifest()),
      }),
    ).not.toThrow()
  })

  test('rejects output that is not a backup recipe array', () => {
    expect(() => parseRestoredRecipes('not JSON')).toThrow(
      /not valid backup recipe JSON/,
    )
    expect(() => parseRestoredRecipes('{}')).toThrow(
      /not valid backup recipe JSON/,
    )
  })
})

describe('restore target guard rails', () => {
  test('uses a guarded development import by default', () => {
    expect(parseRestoreTarget([])).toEqual({ production: false })
    expect(
      convexImportArguments({ jsonlPath: 'recipes.jsonl', production: false }),
    ).toContain('--yes')
    expect(convexRunArguments({ production: false })).not.toContain('--prod')
  })

  test('requires explicit production replacement confirmation', () => {
    expect(() => parseRestoreTarget(['--prod'])).toThrow(/requires both/)
    expect(parseRestoreTarget(['--prod', '--confirm-replace'])).toEqual({
      production: true,
    })
    expect(
      convexImportArguments({ jsonlPath: 'recipes.jsonl', production: true }),
    ).not.toContain('--yes')
    expect(convexRunArguments({ production: true })).toContain('--prod')
  })

  test('rejects production confirmation without a production target', () => {
    expect(() => parseRestoreTarget(['--confirm-replace'])).toThrow(
      /only valid with --prod/,
    )
  })
})
