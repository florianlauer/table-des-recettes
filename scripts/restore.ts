#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'
import {
  backupManifestSchema,
  backupRecipeSchema,
  compareBackupIds,
  restorableProjection,
} from '../src/lib/backup-schema.js'
import type { BackupManifest, BackupRecipe } from '../src/lib/backup-schema.js'
import { buildSearchText } from '../src/lib/normalize.js'
import {
  BACKUP_DIRECTORY,
  MANIFEST_FILE_NAME,
  recipeBackupFileNames,
} from './backup.js'

export type RestoreSnapshot = {
  manifest: BackupManifest
  recipes: BackupRecipe[]
}

const restoredRecipesSchema = z.array(backupRecipeSchema)

function restoreDocument({
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
}: BackupRecipe): Record<string, unknown> {
  return {
    _id: id,
    _creationTime: creationTime,
    title,
    type,
    ...(servings === null ? {} : { servings }),
    ingredients: ingredients.map(({ raw, quantity, unit, label }) => ({
      raw,
      ...(quantity === null ? {} : { quantity }),
      ...(unit === null ? {} : { unit }),
      ...(label === null ? {} : { label }),
    })),
    ingredientsInferred,
    steps,
    searchText: buildSearchText(title, ingredients),
    status,
    ...(slug === null ? {} : { slug }),
    ...(publishedAt === null ? {} : { publishedAt }),
    beautifiedAccepted: false,
    beautifyStatus: 'idle',
  }
}

export function buildRestoreJsonl(recipes: readonly BackupRecipe[]): string {
  return (
    [...recipes]
      .sort((left, right) => compareBackupIds(left.id, right.id))
      .map((recipe) =>
        JSON.stringify(restoreDocument(backupRecipeSchema.parse(recipe))),
      )
      .join('\n') + '\n'
  )
}

export function canonicalDigest(recipes: readonly BackupRecipe[]): string {
  const canonical = recipes
    .map((recipe) => restorableProjection(recipe))
    .sort((left, right) => compareBackupIds(left.id, right.id))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function countsByStatus(recipes: readonly BackupRecipe[]): {
  review: number
  published: number
} {
  const counts = { review: 0, published: 0 }
  for (const recipe of recipes) counts[recipe.status] += 1
  return counts
}

export function assertRestoredBackup({
  expected,
  actual,
  manifest,
}: {
  expected: readonly BackupRecipe[]
  actual: readonly BackupRecipe[]
  manifest: BackupManifest
}): void {
  const actualCounts = countsByStatus(actual)
  if (
    actual.length !== manifest.total ||
    actualCounts.review !== manifest.countsByStatus.review ||
    actualCounts.published !== manifest.countsByStatus.published
  ) {
    throw new Error(
      `Restore verification failed: counts differ (expected ${expected.length} recipes: ${manifest.countsByStatus.review} review, ${manifest.countsByStatus.published} published; actual ${actual.length} recipes: ${actualCounts.review} review, ${actualCounts.published} published).`,
    )
  }
  if (canonicalDigest(expected) !== canonicalDigest(actual)) {
    throw new Error(
      `Restore verification failed: digest differs (expected ${expected.length} recipes, actual ${actual.length} recipes).`,
    )
  }
}

export function assertManifestMatches({
  manifest,
  recipes,
}: RestoreSnapshot): void {
  const counts = countsByStatus(recipes)
  if (
    manifest.total !== recipes.length ||
    manifest.countsByStatus.review !== counts.review ||
    manifest.countsByStatus.published !== counts.published
  ) {
    throw new Error(
      'Restore refused: recipe files do not match the manifest totals.',
    )
  }
}

export async function readRestoreSnapshot({
  backupDirectory = BACKUP_DIRECTORY,
}: {
  backupDirectory?: string
} = {}): Promise<RestoreSnapshot> {
  let manifestSource: string
  try {
    manifestSource = await readFile(
      join(backupDirectory, MANIFEST_FILE_NAME),
      'utf8',
    )
  } catch (error) {
    throw new Error(`Restore refused: ${MANIFEST_FILE_NAME} is missing.`, {
      cause: error,
    })
  }

  const manifest = backupManifestSchema.parse(JSON.parse(manifestSource))
  const fileNames = recipeBackupFileNames(await readdir(backupDirectory)).sort()
  const recipes = await Promise.all(
    fileNames.map(async (fileName) =>
      backupRecipeSchema.parse(
        JSON.parse(await readFile(join(backupDirectory, fileName), 'utf8')),
      ),
    ),
  )
  const snapshot = { manifest, recipes }
  assertManifestMatches(snapshot)
  return snapshot
}

export function parseRestoreTarget(argumentsList: readonly string[]): {
  production: boolean
} {
  const knownArguments = new Set(['--prod', '--confirm-replace'])
  const unknownArgument = argumentsList.find(
    (argument) => !knownArguments.has(argument),
  )
  if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}.`)

  const production = argumentsList.includes('--prod')
  const confirmed = argumentsList.includes('--confirm-replace')
  if (production && !confirmed) {
    throw new Error(
      'Production restore requires both --prod and --confirm-replace.',
    )
  }
  if (!production && confirmed) {
    throw new Error('--confirm-replace is only valid with --prod.')
  }
  return { production }
}

async function runImport({
  jsonlPath,
  production,
}: {
  jsonlPath: string
  production: boolean
}): Promise<void> {
  const argumentsList = convexImportArguments({ jsonlPath, production })
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('npx', argumentsList, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else {
        reject(
          new Error(
            `convex import failed (${signal ? `signal ${signal}` : `exit ${code}`}).`,
          ),
        )
      }
    })
  })
}

async function readRestoredRecipes({
  production,
}: {
  production: boolean
}): Promise<BackupRecipe[]> {
  const argumentsList = convexRunArguments({ production })
  const output = await new Promise<string>((resolvePromise, reject) => {
    const child = spawn('npx', argumentsList, {
      stdio: ['inherit', 'pipe', 'inherit'],
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks).toString('utf8'))
      else {
        reject(
          new Error(
            `convex run failed (${signal ? `signal ${signal}` : `exit ${code}`}).`,
          ),
        )
      }
    })
  })

  return parseRestoredRecipes(output)
}

export function parseRestoredRecipes(output: string): BackupRecipe[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch (error) {
    throw new Error(
      'Restore verification failed: convex run output is not valid backup recipe JSON.',
      { cause: error },
    )
  }
  const result = restoredRecipesSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      'Restore verification failed: convex run output is not valid backup recipe JSON.',
      { cause: result.error },
    )
  }
  return result.data
}

export function convexRunArguments({
  production,
}: {
  production: boolean
}): string[] {
  return [
    'convex',
    'run',
    'export:backupPayload',
    ...(production ? ['--prod'] : []),
  ]
}

export function convexImportArguments({
  jsonlPath,
  production,
}: {
  jsonlPath: string
  production: boolean
}): string[] {
  return [
    'convex',
    'import',
    '--table',
    'recipes',
    '--replace',
    ...(production ? ['--prod'] : ['--yes']),
    jsonlPath,
  ]
}

export async function runRestore(
  argumentsList: readonly string[],
): Promise<void> {
  const { production } = parseRestoreTarget(argumentsList)
  const { manifest, recipes } = await readRestoreSnapshot()
  console.log(
    `Restauration de ${manifest.total} recette(s) : ${manifest.countsByStatus.review} en revue, ${manifest.countsByStatus.published} publiée(s).`,
  )
  console.log(
    'Les scans, les images et leur état de génération ne seront pas restaurés.',
  )

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'recipes-restore-'))
  const jsonlPath = join(temporaryDirectory, 'recipes.jsonl')
  try {
    await writeFile(jsonlPath, buildRestoreJsonl(recipes))
    await runImport({ jsonlPath, production })
    const restoredRecipes = await readRestoredRecipes({ production })
    assertRestoredBackup({
      expected: recipes,
      actual: restoredRecipes,
      manifest,
    })
    console.log('Restauration vérifiée : comptes et digest conformes.')
  } finally {
    await unlink(jsonlPath).catch(() => undefined)
    await rmdir(temporaryDirectory).catch(() => undefined)
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runRestore(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
