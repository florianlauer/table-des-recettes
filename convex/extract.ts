import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { PURGED_ERROR } from './retention'
import type { attemptRecord } from './schema'
import { ingredient, recipeType } from './schema'
import { callOpenRouter } from './lib/openrouter'
import { literalUnion } from './lib/validators'
import { rateLimiter } from './rateLimits'
import { withIllustration, withSearchText } from './lib/recipeWrites'
import { insertRecipeDoc } from './recipeDocs'
import { FAILURE_KINDS, isTerminalFailure } from '../src/shared/failureKinds'
import type { FailureKind } from '../src/shared/failureKinds'
import {
  extractionJsonSchema,
  JSON_SCHEMA_NAME,
} from '../src/shared/recipe-json-schema'
import { EXTRACTION_PROMPT, PROMPT_VERSION } from '../src/shared/recipe-prompt'
import {
  extractionSchema,
  normalizeExtraction,
  RECIPE_SCHEMA_VERSION,
  repairExtraction,
} from '../src/shared/recipe-schema'
import { bytesToBase64 } from '../src/shared/base64'
import { sniffImageHeader } from '../src/shared/imageHeader'
import { MAX_IMAGES_PER_SCAN, MAX_SCAN_BYTES } from '../src/shared/scanLimits'
import {
  LEASE_MS,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
} from '../src/shared/queueContract'

export const MAX_OUTPUT_TOKENS = 8000
// The answer is at most `MAX_OUTPUT_TOKENS` of JSON plus its envelope — a megabyte over any of it.
// The ceiling exists so an oversized body is refused rather than read whole into the action.
export const MAX_RESPONSE_BYTES = 1024 * 1024
export const UNCONSUMED_TICKET_GRACE_MS = 60 * 60 * 1000
export const CONSUMED_TICKET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const TICKET_SWEEP_BATCH = 100
export const RESERVE_SCAN_BATCH = 100

export type { FailureKind }

type ExtractionEnvironment = {
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  OPENROUTER_PROVIDER?: string
}

type AttemptObservation = {
  model: string
  servedProvider: string | null
  latencyMs: number
  costUsd: number
  repairCount: number
}

type Extraction = ReturnType<typeof normalizeExtraction>

export type ExtractionResult =
  | ({ ok: true; extraction: Extraction } & AttemptObservation)
  | ({ ok: false; kind: FailureKind; error: string } & AttemptObservation)

type OpenRouterResponse = {
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: string | null; refusal?: string | null }
  }>
}

/** What the answer says, with no notion of when it arrived — hence testable without a fetch stub. */
export type ExtractionReading =
  | { ok: true; extraction: Extraction; repairCount: number }
  | { ok: false; kind: FailureKind; error: string }

function failure({
  kind,
  error,
  model,
  startedAt,
}: {
  kind: FailureKind
  error: string
  model: string
  startedAt: number
}): ExtractionResult {
  return {
    ok: false,
    kind,
    error,
    model,
    servedProvider: null,
    latencyMs: performance.now() - startedAt,
    costUsd: 0,
    repairCount: 0,
  }
}

export function requestBody({
  model,
  provider,
  dataUris,
}: {
  model: string
  provider: string
  dataUris: readonly string[]
}): string {
  return JSON.stringify({
    model,
    // One message carrying every page, in reading order: a recipe that continues overleaf is only
    // extractable if the model sees both sides at once.
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          ...dataUris.map((url) => ({
            type: 'image_url' as const,
            image_url: { url },
          })),
        ],
      },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: JSON_SCHEMA_NAME,
        strict: true,
        schema: extractionJsonSchema,
      },
    },
    provider: {
      only: [provider],
      allow_fallbacks: false,
      require_parameters: true,
    },
    usage: { include: true },
  })
}

export function interpretResponse(answer: unknown): ExtractionReading {
  const raw = answer as OpenRouterResponse
  const refuse = (kind: FailureKind, error: string): ExtractionReading => ({
    ok: false,
    kind,
    error,
  })

  const choice = raw.choices?.[0]
  if (choice?.message?.refusal) return refuse('refusal', choice.message.refusal)
  if (choice?.finish_reason !== 'stop')
    return refuse(
      'truncated',
      `Réponse tronquée (${String(choice?.finish_reason)})`,
    )
  let parsed: unknown
  try {
    parsed = JSON.parse(choice.message?.content ?? '')
  } catch (error) {
    return refuse('invalid_json', `JSON invalide : ${String(error)}`)
  }
  const repaired = repairExtraction(parsed)
  const validated = extractionSchema.safeParse(repaired.value)
  if (!validated.success)
    return refuse('invalid_schema', validated.error.message)
  if (validated.data.recipes.length === 0)
    return refuse('no_recipes', 'Aucune recette détectée')
  return {
    ok: true,
    extraction: normalizeExtraction(validated.data),
    repairCount: repaired.repairs.length,
  }
}

export async function extractImages({
  blobs,
  environment = process.env,
  fetchImpl = fetch,
}: {
  blobs: readonly (Blob | null)[]
  environment?: ExtractionEnvironment
  fetchImpl?: typeof fetch
}): Promise<ExtractionResult> {
  const startedAt = performance.now()
  const model = environment.OPENROUTER_MODEL ?? ''
  const provider = environment.OPENROUTER_PROVIDER ?? ''
  const apiKey = environment.OPENROUTER_API_KEY ?? ''
  if (!model || !provider || !apiKey) {
    return failure({
      kind: 'transport',
      error: 'Configuration OpenRouter incomplète',
      model,
      startedAt,
    })
  }
  if (blobs.length === 0) {
    return failure({
      kind: 'invalid_image',
      error: 'Le scan ne contient aucune image',
      model,
      startedAt,
    })
  }

  // Every member is checked before a single byte is encoded: one missing or unreadable page must
  // cost a named failure, not a billed call whose answer covers the other pages only.
  const dataUris: string[] = []
  let totalBytes = 0
  for (const [index, blob] of blobs.entries()) {
    const position = `image ${index + 1}/${blobs.length}`
    if (!blob) {
      return failure({
        kind: 'invalid_image',
        error: `Image stockée introuvable (${position})`,
        model,
        startedAt,
      })
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const header = sniffImageHeader({ bytes, fileSize: blob.size })
    if (!header.ok) {
      return failure({
        kind: 'invalid_image',
        error: `${header.message} (${position})`,
        model,
        startedAt,
      })
    }
    totalBytes += blob.size
    if (totalBytes > MAX_SCAN_BYTES) {
      return failure({
        kind: 'invalid_image',
        error: 'Les images du scan dépassent la taille totale autorisée',
        model,
        startedAt,
      })
    }
    dataUris.push(`data:image/${header.format};base64,${bytesToBase64(bytes)}`)
  }

  const call = await callOpenRouter({
    apiKey,
    fetchImpl,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    body: requestBody({ model, provider, dataUris }),
    decode: (raw) => {
      const reading = interpretResponse(raw)
      return reading.ok
        ? { ok: true as const, value: reading }
        : { ok: false as const, kind: reading.kind, error: reading.error }
    },
  })

  const observation = {
    model,
    servedProvider: call.servedProvider,
    latencyMs: call.latencyMs,
    costUsd: call.costUsd,
  }
  return call.ok
    ? {
        ok: true,
        extraction: call.value.extraction,
        repairCount: call.value.repairCount,
        ...observation,
      }
    : {
        ok: false,
        kind: call.kind,
        error: call.error,
        repairCount: 0,
        ...observation,
      }
}

/**
 * Why a scan can never succeed, or the images it is made of. Reservation needs both answers at once,
 * so returning them together keeps the caller from re-deriving them after the check.
 */
export type Eligibility =
  | { eligible: true; storageIds: Id<'_storage'>[] }
  | { eligible: false; error: string }

export function eligibility(scan: Doc<'scans'>): Eligibility {
  if (scan.purgedAt !== undefined)
    return { eligible: false, error: PURGED_ERROR }
  if (scan.attempts >= MAX_ATTEMPTS)
    return { eligible: false, error: 'Plafond de tentatives atteint' }
  if (scan.imageStorageIds.length === 0)
    return { eligible: false, error: 'Le scan ne contient aucune image' }
  if (scan.imageStorageIds.length > MAX_IMAGES_PER_SCAN)
    return {
      eligible: false,
      error: `Le scan dépasse ${MAX_IMAGES_PER_SCAN} images`,
    }
  return { eligible: true, storageIds: scan.imageStorageIds }
}

/**
 * What the queue offers right now: a lease still running, or the batch reservation would consider,
 * oldest first. Single definition of "is there work", shared by the drain and the admin button so
 * the verdict shown to the operator cannot drift from what the drain will actually do.
 */
export async function readQueueWork(
  ctx: QueryCtx,
  now: number,
): Promise<{ liveLease: Doc<'scans'> | null; candidates: Doc<'scans'>[] }> {
  const liveLease = await ctx.db
    .query('scans')
    .withIndex('by_status_started_at', (q) =>
      q.eq('status', 'extracting').gt('startedAt', now - LEASE_MS),
    )
    .take(1)
  const held = liveLease.at(0)
  if (held) return { liveLease: held, candidates: [] }

  const expired = await ctx.db
    .query('scans')
    .withIndex('by_status_started_at', (q) =>
      q.eq('status', 'extracting').lte('startedAt', now - LEASE_MS),
    )
    .take(RESERVE_SCAN_BATCH)
  const pending = await ctx.db
    .query('scans')
    .withIndex('by_status', (q) => q.eq('status', 'pending'))
    .take(RESERVE_SCAN_BATCH)
  return {
    liveLease: null,
    candidates: [...pending, ...expired].sort(
      (left, right) => left.createdAt - right.createdAt,
    ),
  }
}

const reserveResult = v.union(
  v.object({ status: v.literal('lease_held') }),
  v.object({ status: v.literal('no_work') }),
  v.object({ status: v.literal('continue') }),
  v.object({ status: v.literal('rate_limited'), retryAfter: v.number() }),
  v.object({
    status: v.literal('reserved'),
    scanId: v.id('scans'),
    storageIds: v.array(v.id('_storage')),
    attemptId: v.string(),
  }),
)

export const reserve = internalMutation({
  args: {},
  returns: reserveResult,
  handler: async (ctx) => {
    const now = Date.now()
    const { liveLease, candidates } = await readQueueWork(ctx, now)
    if (liveLease) return { status: 'lease_held' as const }

    let selection:
      { scan: Doc<'scans'>; storageIds: Id<'_storage'>[] } | undefined
    for (const scan of candidates) {
      const verdict = eligibility(scan)
      if (!verdict.eligible) {
        await ctx.db.patch(scan._id, { status: 'failed', error: verdict.error })
        continue
      }
      selection = { scan, storageIds: verdict.storageIds }
      break
    }
    // A batch of nothing but disqualified scans is work done, not an empty queue: the next batch
    // has to be loaded rather than letting the drain stop here.
    if (!selection) {
      return candidates.length > 0
        ? { status: 'continue' as const }
        : { status: 'no_work' as const }
    }

    // Quota last, so idle presses of the button cannot exhaust it before any work is confirmed.
    const limit = await rateLimiter.limit(ctx, 'extraction')
    if (!limit.ok) {
      await ctx.db.patch(selection.scan._id, {
        nextAttemptAt: now + limit.retryAfter,
      })
      return {
        status: 'rate_limited' as const,
        retryAfter: limit.retryAfter,
      }
    }
    const { scan } = selection
    const attemptId = `${scan._id}:${scan.attempts + 1}:${now}`
    await ctx.db.patch(scan._id, {
      status: 'extracting',
      attemptId,
      startedAt: now,
      attempts: scan.attempts + 1,
      // A scan predating the field adopts the count it already has rather than restarting at zero
      // and understating what it consumed.
      totalReservations: (scan.totalReservations ?? scan.attempts) + 1,
      nextAttemptAt: undefined,
    })
    return {
      status: 'reserved' as const,
      scanId: scan._id,
      storageIds: selection.storageIds,
      attemptId,
    }
  },
})

const observationArgs = {
  attemptId: v.string(),
  model: v.string(),
  servedProvider: v.union(v.string(), v.null()),
  latencyMs: v.number(),
  costUsd: v.number(),
  repairCount: v.number(),
}

/**
 * Single writer of the journal, so success and failure cannot drift on what an attempt records. The
 * versions are stamped here rather than passed in: the caller is the deployment that ran the call,
 * so any other value would be a lie about which prompt produced the row.
 */
async function journalAttempt(
  ctx: MutationCtx,
  {
    scanId,
    attempt,
  }: { scanId: Id<'scans'>; attempt: Infer<typeof attemptRecord> },
): Promise<void> {
  await ctx.db.insert('extractionAttempts', {
    ...attempt,
    scanId,
    promptVersion: PROMPT_VERSION,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    createdAt: Date.now(),
  })
}

export const finalize = internalMutation({
  args: {
    scanId: v.id('scans'),
    ...observationArgs,
    recipes: v.array(
      v.object({
        title: v.string(),
        type: recipeType,
        servings: v.optional(v.number()),
        ingredients: v.array(ingredient),
        ingredientsInferred: v.boolean(),
        steps: v.array(v.string()),
      }),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, { scanId, recipes, ...observation }) => {
    const scan = await ctx.db.get('scans', scanId)
    // The attempt id alone would not do: it survives the write, so a second identical call would
    // pass the guard and insert a second set of recipes. Requiring `extracting` and clearing the id
    // in the same transaction consumes the attempt.
    if (
      !scan ||
      scan.status !== 'extracting' ||
      scan.attemptId !== observation.attemptId
    )
      return false
    for (const recipe of recipes) {
      await insertRecipeDoc(
        ctx,
        withIllustration(
          withSearchText({
            ...recipe,
            scanId,
            status: 'review' as const,
            imageStorageId: undefined,
            beautifiedAccepted: false,
            noPhotoAvailable: false,
            beautifyStatus: 'idle' as const,
            revision: 0,
          }),
          Date.now(),
        ),
      )
    }
    const attempt = { ...observation, failureKind: null }
    await ctx.db.patch(scanId, {
      status: 'done',
      error: undefined,
      attemptId: undefined,
      startedAt: undefined,
      nextAttemptAt: undefined,
      lastAttempt: attempt,
      totalCostUsd: (scan.totalCostUsd ?? 0) + observation.costUsd,
    })
    await journalAttempt(ctx, { scanId, attempt })
    return true
  },
})

export const recordFailure = internalMutation({
  args: {
    scanId: v.id('scans'),
    ...observationArgs,
    failureKind: literalUnion(FAILURE_KINDS),
    error: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { scanId, failureKind, error, ...observation }) => {
    const scan = await ctx.db.get('scans', scanId)
    if (
      !scan ||
      scan.status !== 'extracting' ||
      scan.attemptId !== observation.attemptId
    )
      return false
    const terminal =
      isTerminalFailure(failureKind) || scan.attempts >= MAX_ATTEMPTS
    const attempt = { ...observation, failureKind }
    await ctx.db.patch(scanId, {
      status: terminal ? 'failed' : 'pending',
      error,
      attemptId: undefined,
      startedAt: undefined,
      nextAttemptAt: undefined,
      lastAttempt: attempt,
      totalCostUsd: (scan.totalCostUsd ?? 0) + observation.costUsd,
    })
    await journalAttempt(ctx, { scanId, attempt })
    return true
  },
})

export const sweepTickets = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now()
    // Two disjoint index ranges rather than one: consumed and unconsumed tickets share no prefix,
    // so a batch of recent consumed rows can never starve the unconsumed purge.
    const unconsumedTickets = await ctx.db
      .query('uploadTickets')
      .withIndex('by_consumed_at_created_at', (q) =>
        q
          .eq('consumedAt', undefined)
          .lt('createdAt', now - UNCONSUMED_TICKET_GRACE_MS),
      )
      .take(TICKET_SWEEP_BATCH)
    const consumedTickets = await ctx.db
      .query('uploadTickets')
      .withIndex('by_consumed_at_created_at', (q) =>
        q
          .gt('consumedAt', 0)
          .lt('consumedAt', now - CONSUMED_TICKET_RETENTION_MS),
      )
      .take(TICKET_SWEEP_BATCH)
    const expiredTickets = [...unconsumedTickets, ...consumedTickets]
    for (const ticket of expiredTickets) {
      await ctx.db.delete(ticket._id)
    }
    return expiredTickets.length
  },
})

export const drain = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const reservation = await ctx.runMutation(internal.extract.reserve, {})
    if (reservation.status === 'lease_held') return null
    if (reservation.status === 'rate_limited') {
      await ctx.scheduler.runAfter(
        reservation.retryAfter,
        internal.extract.drain,
        {},
      )
      return null
    }
    if (reservation.status === 'continue') {
      await ctx.scheduler.runAfter(0, internal.extract.drain, {})
      return null
    }
    if (reservation.status === 'no_work') {
      await ctx.runMutation(internal.extract.sweepTickets, {})
      return null
    }

    const blobs = await Promise.all(
      reservation.storageIds.map((storageId) => ctx.storage.get(storageId)),
    )
    const result = await extractImages({ blobs })
    const observation = {
      scanId: reservation.scanId,
      attemptId: reservation.attemptId,
      model: result.model,
      servedProvider: result.servedProvider,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      repairCount: result.repairCount,
    }
    if (result.ok) {
      await ctx.runMutation(internal.extract.finalize, {
        ...observation,
        recipes: result.extraction.recipes,
      })
    } else {
      await ctx.runMutation(internal.extract.recordFailure, {
        ...observation,
        failureKind: result.kind,
        error: result.error,
      })
    }
    await ctx.scheduler.runAfter(0, internal.extract.drain, {})
    return null
  },
})
