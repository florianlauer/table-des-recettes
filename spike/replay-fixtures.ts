import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  extractionSchemaV1,
  extractionSchemaV2,
} from '../src/shared/recipe-schema.js'
import {
  formatQuantity,
  scaleIngredient,
  scaleQuantity,
} from '../src/lib/scale.js'

type ArchivedRun = {
  schemaVersion?: string
  status?: string
  parsed?: unknown
}

async function jsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory()
        ? jsonFiles(path)
        : Promise.resolve(entry.name.endsWith('.json') ? [path] : [])
    }),
  )
  return nested.flat()
}

export async function replayFixtures({
  directory,
}: {
  directory: string
}): Promise<{
  successRuns: number
  ingredientLines: number
  annotatedLines: number
  scalableLines: number
  scalingRate: number
}> {
  let successRuns = 0
  let ingredientLines = 0
  let annotatedLines = 0
  let scalableLines = 0
  for (const path of await jsonFiles(directory)) {
    const run = JSON.parse(await readFile(path, 'utf8')) as ArchivedRun
    if (run.status !== 'success') continue
    const schema =
      run.schemaVersion === '1' ? extractionSchemaV1 : extractionSchemaV2
    const extraction = schema.parse(run.parsed)
    successRuns += 1
    for (const recipe of extraction.recipes) {
      for (const ingredient of recipe.ingredients) {
        ingredientLines += 1
        if (!ingredient.raw.trim())
          throw new Error(`Empty raw ingredient in ${path}`)
        if (ingredient.quantity === null) continue
        annotatedLines += 1
        for (const factor of [0.5, 1, 1.5, 2]) {
          const domainIngredient = {
            raw: ingredient.raw,
            quantity: ingredient.quantity,
            ...(ingredient.unit === null ? {} : { unit: ingredient.unit }),
          }
          const scaled = scaleIngredient(domainIngredient, factor)
          if (!scaled.scaled) {
            if (scaled.text !== ingredient.raw)
              throw new Error(`Changed unscaled line in ${path}`)
            continue
          }
          if (factor !== 1) {
            const match = /\d+(?:[.,]\d+)?/.exec(ingredient.raw)
            if (!match)
              throw new Error(`Scaled line without a number in ${path}`)
            const expected = `${ingredient.raw.slice(0, match.index)}${formatQuantity(scaleQuantity(ingredient.quantity, factor, ingredient.unit !== null))}${ingredient.raw.slice(match.index + match[0].length)}`
            if (scaled.text !== expected)
              throw new Error(`Incorrect scaled line in ${path}`)
          } else if (scaled.text !== ingredient.raw) {
            throw new Error(`Factor one changed a line in ${path}`)
          }
        }
        if (
          scaleIngredient(
            {
              raw: ingredient.raw,
              quantity: ingredient.quantity,
              ...(ingredient.unit === null ? {} : { unit: ingredient.unit }),
            },
            2,
          ).scaled
        )
          scalableLines += 1
      }
    }
  }
  return {
    successRuns,
    ingredientLines,
    annotatedLines,
    scalableLines,
    scalingRate: scalableLines / annotatedLines,
  }
}
