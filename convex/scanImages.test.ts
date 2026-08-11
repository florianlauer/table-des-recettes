import rateLimiterTest from '@convex-dev/rate-limiter/test'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { MAX_INPUT_BYTES } from '../src/lib/imageHeader'
import { MAX_IMAGES_PER_SCAN, MAX_SCAN_BYTES } from '../src/lib/scanLimits'

const modules = import.meta.glob('./**/*.ts')
const adminToken = 'test-secret'

function setup() {
  const t = convexTest(schema, modules)
  rateLimiterTest.register(t)
  return t
}

beforeEach(() => {
  process.env.ADMIN_TOKEN = adminToken
})

afterEach(() => {
  delete process.env.ADMIN_TOKEN
})

type Harness = ReturnType<typeof setup>

async function upload(t: Harness, bytes = 'image') {
  const ticket = await t.mutation(api.admin.generateUploadUrl, { adminToken })
  if (!ticket.ok) throw new Error(ticket.error)
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([bytes], { type: 'image/jpeg' })),
  )
  return { ticketId: ticket.ticketId, storageId }
}

async function attach(t: Harness, scanId?: Id<'scans'>) {
  const { ticketId, storageId } = await upload(t)
  const result = await t.mutation(api.admin.attachImage, {
    adminToken,
    ticketId,
    storageId,
    scanId,
  })
  return { result, storageId, ticketId }
}

async function newScan(t: Harness) {
  const { result, storageId } = await attach(t)
  if (!result.ok) throw new Error(result.error)
  return { scanId: result.scanId, storageId }
}

async function blobExists(t: Harness, storageId: Id<'_storage'>) {
  return t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)
}

describe('attaching images to a scan', () => {
  test('creates a scan without a parent and appends to the one it is given', async () => {
    const t = setup()
    const { scanId, storageId } = await newScan(t)
    const second = await attach(t, scanId)
    expect(second.result).toEqual({ ok: true, scanId })

    const scan = await t.query(api.admin.getScanForCorrection, {
      adminToken,
      scanId,
    })
    expect(scan?.images.map((image) => image.storageId)).toEqual([
      storageId,
      second.storageId,
    ])
  })

  test('refuses to attach a replayed ticket to a different scan', async () => {
    const t = setup()
    const { scanId } = await newScan(t)
    const other = await newScan(t)
    const { ticketId, storageId } = await upload(t)
    const args = { adminToken, ticketId, storageId }

    await expect(
      t.mutation(api.admin.attachImage, { ...args, scanId }),
    ).resolves.toEqual({ ok: true, scanId })
    // Replaying against the scan that consumed it stays idempotent...
    await expect(
      t.mutation(api.admin.attachImage, { ...args, scanId }),
    ).resolves.toEqual({ ok: true, scanId })
    // ...but asking for another scan is a different intent, not the same result.
    await expect(
      t.mutation(api.admin.attachImage, { ...args, scanId: other.scanId }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'Ce téléversement appartient déjà à un autre scan',
    })
  })

  test('stops at the image ceiling and deletes the blob it refuses', async () => {
    const t = setup()
    const { scanId } = await newScan(t)
    for (let index = 1; index < MAX_IMAGES_PER_SCAN; index += 1) {
      const added = await attach(t, scanId)
      expect(added.result).toMatchObject({ ok: true })
    }

    const refused = await attach(t, scanId)
    expect(refused.result).toMatchObject({
      ok: false,
      error: `Un scan porte au plus ${MAX_IMAGES_PER_SCAN} images`,
    })
    // The bytes are already in storage when the guard runs: leaving them would be the orphan of R4.
    expect(await blobExists(t, refused.storageId)).toBe(false)
    const ticket = await t.run((ctx) =>
      ctx.db.get('uploadTickets', refused.ticketId),
    )
    expect(ticket).toMatchObject({ outcome: 'rejected' })
  })

  test('refuses a batch that would exceed the aggregate byte ceiling', async () => {
    const t = setup()
    // Each image passes the per-image cap; it is their sum that does not. Without the aggregate
    // guard, four of these would leave as one request.
    const heavy = async (scanId?: Id<'scans'>) => {
      const ticket = await t.mutation(api.admin.generateUploadUrl, {
        adminToken,
      })
      if (!ticket.ok) throw new Error(ticket.error)
      const storageId = await t.run((ctx) =>
        ctx.storage.store(
          new Blob([new Uint8Array(MAX_INPUT_BYTES)], { type: 'image/jpeg' }),
        ),
      )
      return t.mutation(api.admin.attachImage, {
        adminToken,
        ticketId: ticket.ticketId,
        storageId,
        scanId,
      })
    }

    const created = await heavy()
    if (!created.ok) throw new Error(created.error)
    expect(MAX_INPUT_BYTES * 2).toBeGreaterThan(MAX_SCAN_BYTES)
    await expect(heavy(created.scanId)).resolves.toMatchObject({
      ok: false,
      error: 'Les images de ce scan dépasseraient la taille totale autorisée',
    })
  })

  test('refuses to touch the images of a purged or extracting scan', async () => {
    const t = setup()
    const { scanId } = await newScan(t)
    await t.run((ctx) => ctx.db.patch(scanId, { status: 'extracting' }))
    expect((await attach(t, scanId)).result).toMatchObject({
      ok: false,
      error: 'Extraction en cours sur ce scan',
    })

    await t.run((ctx) =>
      ctx.db.patch(scanId, { status: 'done', purgedAt: Date.now() }),
    )
    expect((await attach(t, scanId)).result).toMatchObject({
      ok: false,
      error: 'Les photos de ce scan sont purgées',
    })
  })

  test('refuses to touch the images of a scan holding a published recipe', async () => {
    const t = setup()
    const { scanId } = await newScan(t)
    const added = await t.mutation(api.recipeAdmin.addRecipe, {
      adminToken,
      scanId,
    })
    if (!added.ok) throw new Error(added.error)
    await t.mutation(api.recipeAdmin.saveRecipe, {
      adminToken,
      recipeId: added.recipeId,
      expectedRevision: 0,
      title: 'Tarte aux pommes',
      type: 'dessert',
      ingredients: [],
      ingredientsInferred: false,
      steps: [],
    })
    await t.mutation(api.recipeAdmin.publishRecipe, {
      adminToken,
      recipeId: added.recipeId,
    })

    expect((await attach(t, scanId)).result).toMatchObject({
      ok: false,
      error: 'Une recette de ce scan est publiée : dépublie-la d’abord',
    })
  })
})

describe('detaching images', () => {
  test('removes the image, deletes its blob, and flags the divergence', async () => {
    const t = setup()
    const { scanId, storageId } = await newScan(t)
    const second = await attach(t, scanId)
    await t.run((ctx) => ctx.db.patch(scanId, { status: 'done' }))

    await expect(
      t.mutation(api.admin.detachImage, { adminToken, scanId, storageId }),
    ).resolves.toEqual({ ok: true })
    expect(await blobExists(t, storageId)).toBe(false)
    const scan = await t.query(api.admin.getScanForCorrection, {
      adminToken,
      scanId,
    })
    expect(scan?.images.map((image) => image.storageId)).toEqual([
      second.storageId,
    ])
    expect(scan?.imagesChangedAt).not.toBeNull()
  })

  test('lets a treated scan go down to zero images but never a pending one', async () => {
    const t = setup()
    const pending = await newScan(t)
    await expect(
      t.mutation(api.admin.detachImage, {
        adminToken,
        scanId: pending.scanId,
        storageId: pending.storageId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'Un scan en attente doit garder au moins une image',
    })

    // Replacing a blurry page means passing through zero; only the queue's reach makes that unsafe.
    await t.run((ctx) => ctx.db.patch(pending.scanId, { status: 'done' }))
    await expect(
      t.mutation(api.admin.detachImage, {
        adminToken,
        scanId: pending.scanId,
        storageId: pending.storageId,
      }),
    ).resolves.toEqual({ ok: true })
  })

  test('refuses an image that belongs to another scan', async () => {
    const t = setup()
    const { scanId } = await newScan(t)
    const other = await newScan(t)
    await expect(
      t.mutation(api.admin.detachImage, {
        adminToken,
        scanId,
        storageId: other.storageId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'Cette image n’est pas dans ce scan',
    })
  })
})

describe('rescanning', () => {
  test('drops the drafts, clears the divergence flag, and reopens the attempts', async () => {
    const t = setup()
    const { scanId } = await newScan(t)
    await t.run((ctx) =>
      ctx.db.patch(scanId, {
        status: 'failed',
        attempts: 3,
        error: 'Plafond de tentatives atteint',
        imagesChangedAt: Date.now(),
        totalReservations: 3,
        totalCostUsd: 0.02,
      }),
    )
    const added = await t.mutation(api.recipeAdmin.addRecipe, {
      adminToken,
      scanId,
    })
    if (!added.ok) throw new Error(added.error)

    await expect(
      t.mutation(api.admin.rescan, { adminToken, scanId }),
    ).resolves.toEqual({ ok: true })

    const scan = await t.run((ctx) => ctx.db.get('scans', scanId))
    expect(scan).toMatchObject({
      status: 'pending',
      attempts: 0,
      // What the scan actually consumed survives the reset: `attempts` cannot answer that question.
      totalReservations: 3,
      totalCostUsd: 0.02,
    })
    expect(scan?.error).toBeUndefined()
    expect(scan?.imagesChangedAt).toBeUndefined()
    expect(
      await t.run((ctx) => ctx.db.get('recipes', added.recipeId)),
    ).toBeNull()
  })

  test('refuses a scan without images', async () => {
    const t = setup()
    const { scanId } = await newScan(t)
    await t.run((ctx) =>
      ctx.db.patch(scanId, { status: 'done', imageStorageIds: [] }),
    )
    await expect(
      t.mutation(api.admin.rescan, { adminToken, scanId }),
    ).resolves.toMatchObject({
      ok: false,
      error: `Un scan à relancer doit porter de 1 à ${MAX_IMAGES_PER_SCAN} images`,
    })
  })

  test('refuses a purged scan', async () => {
    const t = setup()
    const { scanId } = await newScan(t)
    await t.run((ctx) => ctx.db.patch(scanId, { purgedAt: Date.now() }))
    await expect(
      t.mutation(api.admin.rescan, { adminToken, scanId }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'Les photos de ce scan sont purgées',
    })
  })
})
