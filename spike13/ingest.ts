#!/usr/bin/env node
import { access, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'
import type { Metadata } from 'sharp'

const FORBIDDEN_METADATA_KEYS = [
  'orientation',
  'exif',
  'icc',
  'iptc',
  'xmp',
  'tifftagPhotoshop',
  'comments',
] as const

export function retainedMetadata(metadata: Metadata): string[] {
  return FORBIDDEN_METADATA_KEYS.filter((key) => metadata[key] !== undefined)
}

// 2000px / q80 is the production normalisation, not a bench convenience: downscaling harder would
// itself remove the print screen and the moiré, which are exactly the defects the model is asked to
// fix. A bench that pre-cleans its own input cannot tell a good model from a resize.
export async function normalizeImage({
  inputPath,
  outputPath,
}: {
  inputPath: string
  outputPath: string
}): Promise<Metadata> {
  await mkdir(resolve(outputPath, '..'), { recursive: true })
  await sharp(inputPath)
    .rotate()
    .resize({
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toColorspace('srgb')
    .jpeg({ quality: 80 })
    .toFile(outputPath)

  const metadata = await sharp(outputPath).metadata()
  const retained = retainedMetadata(metadata)
  if (retained.length > 0) {
    throw new Error(
      `Métadonnées restantes dans ${outputPath} : ${retained.join(', ')}.`,
    )
  }
  return metadata
}

// Outside the repo: the originals carry the home GPS coordinates and the repo is public.
export const INBOX_DIRECTORY = resolve(
  homedir(),
  'Downloads',
  'table-des-recettes-inbox',
)

export async function findInboxImage(
  stem: string,
  inboxDirectory = INBOX_DIRECTORY,
): Promise<string> {
  const stems = [stem, stem.toLowerCase(), stem.toUpperCase()]
  const extensions = ['jpg', 'jpeg', 'JPG', 'JPEG']
  for (const candidateStem of stems) {
    for (const extension of extensions) {
      const candidate = resolve(inboxDirectory, `${candidateStem}.${extension}`)
      try {
        await access(candidate)
        return candidate
      } catch {
        // The originals keep whatever casing the phone produced.
      }
    }
  }

  for (const candidateStem of stems) {
    for (const extension of ['heic', 'HEIC'] as const) {
      const candidate = resolve(inboxDirectory, `${candidateStem}.${extension}`)
      try {
        await access(candidate)
      } catch {
        continue
      }
      const filename = basename(candidate)
      const jpegFilename = `${filename.slice(0, -extension.length)}jpg`
      throw new Error(
        `${stem} n'existe qu'en HEIC, que sharp ne sait pas décoder. Convertis-le d'abord : ` +
          `sips -s format jpeg -s formatOptions 95 ${filename} --out ${jpegFilename}`,
      )
    }
  }

  throw new Error(
    `Image ${stem} introuvable dans ${inboxDirectory} (JPEG attendu).`,
  )
}

async function main(): Promise<void> {
  const dish = process.argv[2]
  if (!dish || !/^[a-z][a-z0-9-]*$/i.test(dish)) {
    throw new Error(
      'Usage : npm run ingest13 -- <role> [source] (ex. « recadre1 img_4312 »).',
    )
  }
  const inputPath = await findInboxImage(process.argv[3] ?? dish)
  const outputPath = resolve(
    'spike13/fixtures/dishes',
    `${dish.toLowerCase()}.jpg`,
  )
  const metadata = await normalizeImage({ inputPath, outputPath })
  console.log(
    `${basename(inputPath)} → ${outputPath} (${metadata.width}×${metadata.height}, ${metadata.space}, métadonnées absentes)`,
  )
  console.log(
    'Note la correspondance rôle/source dans spike13/fixtures/dishes/README.md.',
  )
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
