import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation } from './_generated/server'
import { ingredient, recipeType } from './schema'
import { literalUnion } from './lib/validators'
import { rateLimiter } from './rateLimits'
import { withSearchText } from './lib/recipeWrites'
import { FAILURE_KINDS, isTerminalFailure } from '../src/lib/failureKinds'
import type { FailureKind } from '../src/lib/failureKinds'
import {
  extractionJsonSchema,
  JSON_SCHEMA_NAME,
} from '../src/lib/recipe-json-schema'
import { EXTRACTION_PROMPT } from '../src/lib/recipe-prompt'
import {
  extractionSchema,
  normalizeExtraction,
  repairExtraction,
} from '../src/lib/recipe-schema'
import { sniffImageHeader } from '../src/lib/imageHeader'

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1'
export const REQUEST_TIMEOUT_MS = 120_000
export const MAX_ATTEMPTS = 3
// One reservation bills at most one HTTP request, so retries live at the queue level where
// MAX_ATTEMPTS and the rate limiter already account for them. The margin keeps a replacement
// worker behind the request deadline and the action overhead.
export const LEASE_MS = REQUEST_TIMEOUT_MS + 30_000
export const MAX_OUTPUT_TOKENS = 8000
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
  provider?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: string | null; refusal?: string | null }
  }>
  usage?: { cost?: number }
  error?: { message?: string }
}

/** What the answer says, with no notion of when it arrived — hence testable without a fetch stub. */
export type ResponseReading = {
  costUsd: number
  servedProvider: string | null
} & (
  | { ok: true; extraction: Extraction; repairCount: number }
  | { ok: false; kind: FailureKind; error: string }
)

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

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
  }
  return btoa(chunks.join(''))
}

export function requestBody({
  model,
  provider,
  dataUri,
}: {
  model: string
  provider: string
  dataUri: string
}): string {
  return JSON.stringify({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: dataUri } },
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

export function interpretResponse({
  ok,
  status,
  body,
}: {
  ok: boolean
  status: number
  body: string
}): ResponseReading {
  let raw: OpenRouterResponse
  try {
    raw = JSON.parse(body) as OpenRouterResponse
  } catch {
    return {
      ok: false,
      kind: 'transport',
      error: `Réponse OpenRouter illisible : HTTP ${status}`,
      costUsd: 0,
      servedProvider: null,
    }
  }
  // Billed even when the answer is unusable, so the cost is read before any rejection.
  const costUsd = typeof raw.usage?.cost === 'number' ? raw.usage.cost : 0
  const servedProvider = raw.provider ?? null
  const refuse = (kind: FailureKind, error: string): ResponseReading => ({
    ok: false,
    kind,
    error,
    costUsd,
    servedProvider,
  })

  if (!ok)
    return refuse(
      'transport',
      `OpenRouter HTTP ${status} : ${raw.error?.message ?? body}`,
    )
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
    costUsd,
    servedProvider,
  }
}

export async function extractImage({
  blob,
  environment = process.env,
  fetchImpl = fetch,
}: {
  blob: Blob
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

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const header = sniffImageHeader({ bytes, fileSize: blob.size })
  if (!header.ok) {
    return failure({
      kind: 'invalid_image',
      error: header.message,
      model,
      startedAt,
    })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response
  let body: string
  try {
    response = await fetchImpl(`${OPENROUTER_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: requestBody({
        model,
        provider,
        dataUri: `data:image/${header.format};base64,${bytesToBase64(bytes)}`,
      }),
    })
    body = await response.text()
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === 'AbortError'
    return failure({
      kind: timedOut ? 'timeout' : 'transport',
      error: timedOut
        ? 'Délai OpenRouter dépassé'
        : `Transport OpenRouter : ${String(error)}`,
      model,
      startedAt,
    })
  } finally {
    clearTimeout(timer)
  }

  const reading = interpretResponse({
    ok: response.ok,
    status: response.status,
    body,
  })
  const observation = {
    model,
    servedProvider: reading.servedProvider,
    latencyMs: performance.now() - startedAt,
    costUsd: reading.costUsd,
  }
  return reading.ok
    ? {
        ok: true,
        extraction: reading.extraction,
        repairCount: reading.repairCount,
        ...observation,
      }
    : {
        ok: false,
        kind: reading.kind,
        error: reading.error,
        repairCount: 0,
        ...observation,
      }
}

/**
 * Why a scan can never succeed, or the single image it is made of. Reservation needs both answers
 * at once, so returning them together keeps the caller from re-deriving the image after the check.
 */
export type Eligibility =
  | { eligible: true; storageId: Id<'_storage'> }
  | { eligible: false; error: string }

export function eligibility(scan: Doc<'scans'>): Eligibility {
  if (scan.attempts >= MAX_ATTEMPTS)
    return { eligible: false, error: 'Plafond de tentatives atteint' }
  const storageId = scan.imageStorageIds.at(0)
  if (!storageId || scan.imageStorageIds.length !== 1)
    return {
      eligible: false,
      error: 'Le scan doit contenir exactement une image',
    }
  return { eligible: true, storageId }
}

const reserveResult = v.union(
  v.object({ status: v.literal('lease_held') }),
  v.object({ status: v.literal('no_work') }),
  v.object({ status: v.literal('continue') }),
  v.object({ status: v.literal('rate_limited'), retryAfter: v.number() }),
  v.object({
    status: v.literal('reserved'),
    scanId: v.id('scans'),
    storageId: v.id('_storage'),
    attemptId: v.string(),
  }),
)

export const reserve = internalMutation({
  args: {},
  returns: reserveResult,
  handler: async (ctx) => {
    const now = Date.now()
    const liveLease = await ctx.db
      .query('scans')
      .withIndex('by_status_started_at', (q) =>
        q.eq('status', 'extracting').gt('startedAt', now - LEASE_MS),
      )
      .take(1)
    if (liveLease.length > 0) return { status: 'lease_held' as const }

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
    const candidates = [...pending, ...expired].sort(
      (left, right) => left.createdAt - right.createdAt,
    )

    let selection: { scan: Doc<'scans'>; storageId: Id<'_storage'> } | undefined
    for (const scan of candidates) {
      const verdict = eligibility(scan)
      if (!verdict.eligible) {
        await ctx.db.patch(scan._id, { status: 'failed', error: verdict.error })
        continue
      }
      selection = { scan, storageId: verdict.storageId }
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
    if (!limit.ok)
      return {
        status: 'rate_limited' as const,
        retryAfter: limit.retryAfter,
      }
    const { scan } = selection
    const attemptId = `${scan._id}:${scan.attempts + 1}:${now}`
    await ctx.db.patch(scan._id, {
      status: 'extracting',
      attemptId,
      startedAt: now,
      attempts: scan.attempts + 1,
    })
    return {
      status: 'reserved' as const,
      scanId: scan._id,
      storageId: selection.storageId,
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
    if (!scan || scan.attemptId !== observation.attemptId) return false
    for (const recipe of recipes) {
      await ctx.db.insert(
        'recipes',
        withSearchText({
          ...recipe,
          scanId,
          status: 'review' as const,
          beautifiedAccepted: false,
          beautifyStatus: 'idle' as const,
        }),
      )
    }
    await ctx.db.patch(scanId, {
      status: 'done',
      error: undefined,
      lastAttempt: { ...observation, failureKind: null },
    })
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
    if (!scan || scan.attemptId !== observation.attemptId) return false
    const terminal =
      isTerminalFailure(failureKind) || scan.attempts >= MAX_ATTEMPTS
    await ctx.db.patch(scanId, {
      status: terminal ? 'failed' : 'pending',
      error,
      attemptId: undefined,
      startedAt: undefined,
      lastAttempt: { ...observation, failureKind },
    })
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

    const blob = await ctx.storage.get(reservation.storageId)
    const result = blob
      ? await extractImage({ blob })
      : failure({
          kind: 'invalid_image',
          error: 'Image stockée introuvable',
          model: process.env.OPENROUTER_MODEL ?? '',
          startedAt: performance.now(),
        })
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
