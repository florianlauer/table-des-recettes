import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { findInboxImage, normalizeImage, retainedMetadata } from './ingest.js'

describe('retainedMetadata', () => {
  it('reports nothing on a stripped image', () => {
    expect(retainedMetadata({ width: 10, height: 10 } as never)).toEqual([])
  })

  it('names every metadata block that survived', () => {
    expect(
      retainedMetadata({
        exif: Buffer.from('x'),
        icc: Buffer.from('y'),
      } as never),
    ).toEqual(['exif', 'icc'])
  })
})

describe('normalizeImage', () => {
  it('caps the long side at 2000px without enlarging a smaller source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't13-ingest-'))
    const inputPath = join(directory, 'big.jpg')
    const outputPath = join(directory, 'out.jpg')
    await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: '#888' },
    })
      .jpeg()
      .toFile(inputPath)

    const metadata = await normalizeImage({ inputPath, outputPath })

    expect(metadata.width).toBe(2000)
    expect(metadata.height).toBe(1500)
  })

  it('leaves a source smaller than the cap untouched in size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't13-ingest-'))
    const inputPath = join(directory, 'small.jpg')
    const outputPath = join(directory, 'out.jpg')
    await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#888' },
    })
      .jpeg()
      .toFile(inputPath)

    const metadata = await normalizeImage({ inputPath, outputPath })

    expect(metadata.width).toBe(800)
    expect(metadata.height).toBe(600)
  })

  it('strips the metadata a phone photo carries, GPS included', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't13-ingest-'))
    const inputPath = join(directory, 'tagged.jpg')
    const outputPath = join(directory, 'out.jpg')
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#888' },
    })
      .withMetadata({ exif: { IFD0: { Copyright: 'test' } } })
      .jpeg()
      .toFile(inputPath)

    const metadata = await normalizeImage({ inputPath, outputPath })

    expect(retainedMetadata(metadata)).toEqual([])
  })
})

describe('findInboxImage', () => {
  it('explains how to convert an HEIC source before ingestion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't13-ingest-'))
    await writeFile(join(directory, 'dish.HEIC'), '')

    await expect(findInboxImage('dish', directory)).rejects.toThrow(/sips/)
  })
})
