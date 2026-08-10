import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normalizeImage, retainedMetadata } from './ingest.js'

describe('ingest', () => {
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'spike-t1-ingest-'))
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('applies EXIF orientation then strips all metadata', async () => {
    const inputPath = resolve(directory, 'oriented.jpg')
    const outputPath = resolve(directory, 'normalized.jpg')
    await sharp({
      create: { width: 10, height: 20, channels: 3, background: 'red' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(inputPath)

    const inputMetadata = await sharp(inputPath).metadata()
    expect(inputMetadata.orientation).toBe(6)
    const outputMetadata = await normalizeImage({ inputPath, outputPath })

    expect(outputMetadata.width).toBe(20)
    expect(outputMetadata.height).toBe(10)
    expect(outputMetadata.format).toBe('jpeg')
    expect(outputMetadata.space).toBe('srgb')
    expect(retainedMetadata(outputMetadata)).toEqual([])
  })

  it('does not enlarge a small image', async () => {
    const inputPath = resolve(directory, 'small.jpg')
    const outputPath = resolve(directory, 'small-normalized.jpg')
    await sharp({
      create: { width: 120, height: 80, channels: 3, background: 'white' },
    })
      .jpeg()
      .toFile(inputPath)
    const outputMetadata = await normalizeImage({ inputPath, outputPath })
    expect(outputMetadata.width).toBe(120)
    expect(outputMetadata.height).toBe(80)
  })
})
