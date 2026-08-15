#!/usr/bin/env node
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'
import {
  BACKUP_FORMAT_VERSION,
  backupManifestSchema,
  backupRecipeSchema,
  countRecipesByStatus,
} from '../src/shared/backup-schema.js'
import type {
  BackupManifest,
  BackupRecipe,
} from '../src/shared/backup-schema.js'

export const BACKUP_DIRECTORY = 'backup'
export const MANIFEST_FILE_NAME = 'LAST_RUN.json'
export const FETCH_TIMEOUT_MS = 15_000

const backupPayloadSchema = z.strictObject({
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  generatedAt: z.iso.datetime(),
  recipes: z.array(backupRecipeSchema),
})

type BackupPayload = z.infer<typeof backupPayloadSchema>

export type BackupPlan = {
  manifestContents: string
  recipeWrites: Array<{ fileName: string; contents: string }>
  deletions: string[]
  unchanged: number
  total: number
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

// `parse` is what fixes the key order, so the bytes never depend on how the payload arrived.
export function serializeBackupRecipe(recipe: BackupRecipe): string {
  return serializeJson(backupRecipeSchema.parse(recipe))
}

export function recipeFileName({
  id,
  slug,
}: Pick<BackupRecipe, 'id' | 'slug'>): string {
  const reducedSlug = slug
    ?.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const isReserved = slug?.toUpperCase() === 'LAST_RUN'
  return `${reducedSlug && !isReserved ? reducedSlug : id}.json`
}

export function recipeBackupFileNames(fileNames: readonly string[]): string[] {
  return fileNames.filter(
    (fileName) => fileName.endsWith('.json') && fileName !== MANIFEST_FILE_NAME,
  )
}

export function assertNonEmpty(recipes: readonly BackupRecipe[]): void {
  if (recipes.length === 0) {
    throw new Error('Backup refused: the endpoint returned zero recipes.')
  }
}

export function assertPruneAllowed({
  deletionCount,
  existingRecipeCount,
  allowPrune,
}: {
  deletionCount: number
  existingRecipeCount: number
  allowPrune: boolean
}): void {
  if (
    !allowPrune &&
    existingRecipeCount > 0 &&
    deletionCount / existingRecipeCount > 0.2
  ) {
    throw new Error(
      `Backup refused: deleting ${deletionCount} of ${existingRecipeCount} recipe files exceeds 20%.`,
    )
  }
}

function manifestFor({
  generatedAt,
  recipes,
}: Pick<BackupPayload, 'generatedAt' | 'recipes'>): BackupManifest {
  return backupManifestSchema.parse({
    formatVersion: BACKUP_FORMAT_VERSION,
    generatedAt,
    total: recipes.length,
    countsByStatus: countRecipesByStatus(recipes),
  })
}

export function createBackupPlan({
  payload,
  existingFileNames,
  existingContents,
  allowPrune,
}: {
  payload: unknown
  existingFileNames: readonly string[]
  existingContents: ReadonlyMap<string, string>
  allowPrune: boolean
}): BackupPlan {
  const parsed = backupPayloadSchema.parse(payload)
  assertNonEmpty(parsed.recipes)

  const desiredFiles = new Map<string, { id: string; contents: string }>()
  for (const recipe of parsed.recipes) {
    const fileName = recipeFileName(recipe)
    const previous = desiredFiles.get(fileName)
    if (previous) {
      throw new Error(
        `Backup refused: recipes ${previous.id} and ${recipe.id} both map to ${fileName}.`,
      )
    }
    desiredFiles.set(fileName, {
      id: recipe.id,
      contents: serializeBackupRecipe(recipe),
    })
  }

  const existingRecipeFiles = recipeBackupFileNames(existingFileNames)
  const deletions = existingRecipeFiles.filter(
    (fileName) => !desiredFiles.has(fileName),
  )
  assertPruneAllowed({
    deletionCount: deletions.length,
    existingRecipeCount: existingRecipeFiles.length,
    allowPrune,
  })

  const recipeWrites = [...desiredFiles].flatMap(([fileName, { contents }]) =>
    existingContents.get(fileName) === contents ? [] : [{ fileName, contents }],
  )
  return {
    manifestContents: serializeJson(manifestFor(parsed)),
    recipeWrites,
    deletions,
    unchanged: desiredFiles.size - recipeWrites.length,
    total: desiredFiles.size,
  }
}

export function requireBackupEnvironment({
  url,
  token,
}: {
  url: string | undefined
  token: string | undefined
}): { url: string; token: string } {
  if (!url) throw new Error('Missing environment variable: CONVEX_BACKUP_URL.')
  if (!token) throw new Error('Missing environment variable: BACKUP_TOKEN.')
  return { url, token }
}

async function readExistingBackup(): Promise<{
  fileNames: string[]
  contents: Map<string, string>
}> {
  let fileNames: string[]
  try {
    fileNames = await readdir(BACKUP_DIRECTORY)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { fileNames: [], contents: new Map() }
    }
    throw error
  }
  const jsonFileNames = fileNames.filter((fileName) =>
    fileName.endsWith('.json'),
  )
  const entries = await Promise.all(
    jsonFileNames.map(
      async (fileName) =>
        [
          fileName,
          await readFile(join(BACKUP_DIRECTORY, fileName), 'utf8'),
        ] as const,
    ),
  )
  return { fileNames, contents: new Map(entries) }
}

async function fetchBackupPayload({
  url,
  token,
}: {
  url: string
  token: string
}): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Backup endpoint returned HTTP ${response.status}.`)
  }
  return response.json() as Promise<unknown>
}

export async function runBackup(): Promise<void> {
  const environment = requireBackupEnvironment({
    url: process.env.CONVEX_BACKUP_URL,
    token: process.env.BACKUP_TOKEN,
  })
  const payload = await fetchBackupPayload(environment)
  const existing = await readExistingBackup()
  const plan = createBackupPlan({
    payload,
    existingFileNames: existing.fileNames,
    existingContents: existing.contents,
    allowPrune: process.env.BACKUP_ALLOW_PRUNE === '1',
  })

  await mkdir(BACKUP_DIRECTORY, { recursive: true })
  await Promise.all(
    plan.recipeWrites.map(({ fileName, contents }) =>
      writeFile(join(BACKUP_DIRECTORY, fileName), contents),
    ),
  )
  await Promise.all(
    plan.deletions.map((fileName) => unlink(join(BACKUP_DIRECTORY, fileName))),
  )
  if (existing.contents.get(MANIFEST_FILE_NAME) !== plan.manifestContents) {
    await writeFile(
      join(BACKUP_DIRECTORY, MANIFEST_FILE_NAME),
      plan.manifestContents,
    )
  }

  console.log(
    `Backup complete: ${plan.recipeWrites.length} written, ${plan.deletions.length} deleted, ${plan.unchanged} unchanged.`,
  )
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runBackup().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
