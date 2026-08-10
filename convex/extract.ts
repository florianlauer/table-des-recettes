import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation } from './_generated/server'
import { ingredient, recipeType } from './schema'
import { rateLimiter } from './rateLimits'
import { withSearchText } from './lib/recipeWrites'
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
// One transport attempt keeps one quota unit equal to at most one potentially billed HTTP request.
export const MAX_TRANSPORT_ATTEMPTS = 1
// The margin keeps a replacement worker behind the request deadline and action overhead.
export const LEASE_MS = REQUEST_TIMEOUT_MS * MAX_TRANSPORT_ATTEMPTS + 30_000
export const MAX_OUTPUT_TOKENS = 8000
export const UNCONSUMED_TICKET_GRACE_MS = 60 * 60 * 1000
export const CONSUMED_TICKET_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const TICKET_SWEEP_BATCH = 100
export const RESERVE_SCAN_BATCH = 100

export type FailureKind =
  | 'refusal'
  | 'truncated'
  | 'invalid_json'
  | 'invalid_schema'
  | 'timeout'
  | 'transport'
  | 'no_recipes'
  | 'invalid_image'

type ExtractionEnvironment = {
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  OPENROUTER_PROVIDER?: string
}

type AttemptObservation = {
  model: string
  servedProvider?: string
  latencyMs: number
  costUsd: number
  repairCount: number
}

export type ExtractionResult =
  | ({
      ok: true
      extraction: ReturnType<typeof normalizeExtraction>
    } & AttemptObservation)
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

function failure({
  kind,
  error,
  model,
  startedAt,
  costUsd = 0,
  servedProvider,
}: {
  kind: FailureKind
  error: string
  model: string
  startedAt: number
  costUsd?: number
  servedProvider?: string
}): ExtractionResult {
  return {
    ok: false,
    kind,
    error,
    model,
    latencyMs: performance.now() - startedAt,
    costUsd,
    repairCount: 0,
    ...(servedProvider === undefined ? {} : { servedProvider }),
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
  }
  return btoa(chunks.join(''))
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
  const dataUri = `data:image/${header.format};base64,${bytesToBase64(bytes)}`

  let lastTransportError = 'Erreur de transport OpenRouter'
  let lastKind: 'timeout' | 'transport' = 'transport'
  let totalCostUsd = 0
  for (
    let requestAttempt = 1;
    requestAttempt <= MAX_TRANSPORT_ATTEMPTS;
    requestAttempt += 1
  ) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(
        `${OPENROUTER_API_URL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
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
          }),
        },
      )
      const responseText = await response.text()
      let raw: OpenRouterResponse
      try {
        raw = JSON.parse(responseText) as OpenRouterResponse
      } catch {
        lastTransportError = `Réponse OpenRouter illisible : HTTP ${response.status}`
        lastKind = 'transport'
        continue
      }
      totalCostUsd += typeof raw.usage?.cost === 'number' ? raw.usage.cost : 0
      const servedProvider = raw.provider
      if (!response.ok) {
        lastTransportError = `OpenRouter HTTP ${response.status} : ${raw.error?.message ?? responseText}`
        lastKind = 'transport'
        continue
      }
      const choice = raw.choices?.[0]
      if (choice?.message?.refusal) {
        return failure({
          kind: 'refusal',
          error: choice.message.refusal,
          model,
          startedAt,
          costUsd: totalCostUsd,
          servedProvider,
        })
      }
      if (choice?.finish_reason !== 'stop') {
        return failure({
          kind: 'truncated',
          error: `Réponse tronquée (${String(choice?.finish_reason)})`,
          model,
          startedAt,
          costUsd: totalCostUsd,
          servedProvider,
        })
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(choice.message?.content ?? '')
      } catch (error) {
        return failure({
          kind: 'invalid_json',
          error: `JSON invalide : ${String(error)}`,
          model,
          startedAt,
          costUsd: totalCostUsd,
          servedProvider,
        })
      }
      const repaired = repairExtraction(parsed)
      const validated = extractionSchema.safeParse(repaired.value)
      if (!validated.success) {
        return failure({
          kind: 'invalid_schema',
          error: validated.error.message,
          model,
          startedAt,
          costUsd: totalCostUsd,
          servedProvider,
        })
      }
      if (validated.data.recipes.length === 0) {
        return failure({
          kind: 'no_recipes',
          error: 'Aucune recette détectée',
          model,
          startedAt,
          costUsd: totalCostUsd,
          servedProvider,
        })
      }
      return {
        ok: true,
        extraction: normalizeExtraction(validated.data),
        model,
        latencyMs: performance.now() - startedAt,
        costUsd: totalCostUsd,
        repairCount: repaired.repairs.length,
        ...(servedProvider === undefined ? {} : { servedProvider }),
      }
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === 'AbortError'
      lastKind = timedOut ? 'timeout' : 'transport'
      lastTransportError = timedOut
        ? 'Délai OpenRouter dépassé'
        : `Transport OpenRouter : ${String(error)}`
    } finally {
      clearTimeout(timer)
    }
  }
  return failure({
    kind: lastKind,
    error: lastTransportError,
    model,
    startedAt,
    costUsd: totalCostUsd,
  })
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
    let selection:
      | {
          candidate: (typeof candidates)[number]
          storageId: (typeof candidates)[number]['imageStorageIds'][number]
        }
      | undefined
    for (const scan of candidates) {
      if (scan.attempts >= MAX_ATTEMPTS) {
        await ctx.db.patch(scan._id, {
          status: 'failed',
          error: 'Plafond de tentatives atteint',
        })
        continue
      }
      const storageId =
        scan.imageStorageIds.length === 1
          ? scan.imageStorageIds.at(0)
          : undefined
      if (!storageId) {
        await ctx.db.patch(scan._id, {
          status: 'failed',
          error: 'Le scan doit contenir exactement une image',
        })
        continue
      }
      selection = { candidate: scan, storageId }
      break
    }
    if (!selection) {
      return candidates.length > 0
        ? { status: 'continue' as const }
        : { status: 'no_work' as const }
    }
    const { candidate, storageId } = selection
    const limit = await rateLimiter.limit(ctx, 'extraction')
    if (!limit.ok)
      return {
        status: 'rate_limited' as const,
        retryAfter: limit.retryAfter,
      }
    const attemptId = `${candidate._id}:${candidate.attempts + 1}:${now}`
    await ctx.db.patch(candidate._id, {
      status: 'extracting',
      attemptId,
      startedAt: now,
      attempts: candidate.attempts + 1,
    })
    return {
      status: 'reserved' as const,
      scanId: candidate._id,
      storageId,
      attemptId,
    }
  },
})

const observationArgs = {
  attemptId: v.string(),
  model: v.string(),
  servedProvider: v.optional(v.string()),
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
  handler: async (
    ctx,
    {
      scanId,
      attemptId,
      model,
      servedProvider,
      latencyMs,
      costUsd,
      repairCount,
      recipes,
    },
  ) => {
    const scan = await ctx.db.get('scans', scanId)
    if (!scan || scan.attemptId !== attemptId) return false
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
      lastAttempt: {
        attemptId,
        model,
        latencyMs,
        costUsd,
        repairCount,
        ...(servedProvider === undefined ? {} : { servedProvider }),
      },
    })
    return true
  },
})

export const recordFailure = internalMutation({
  args: {
    scanId: v.id('scans'),
    ...observationArgs,
    failureKind: v.union(
      v.literal('refusal'),
      v.literal('truncated'),
      v.literal('invalid_json'),
      v.literal('invalid_schema'),
      v.literal('timeout'),
      v.literal('transport'),
      v.literal('no_recipes'),
      v.literal('invalid_image'),
    ),
    error: v.string(),
  },
  returns: v.boolean(),
  handler: async (
    ctx,
    {
      scanId,
      attemptId,
      model,
      servedProvider,
      latencyMs,
      costUsd,
      repairCount,
      failureKind,
      error,
    },
  ) => {
    const scan = await ctx.db.get('scans', scanId)
    if (!scan || scan.attemptId !== attemptId) return false
    const terminal =
      failureKind === 'invalid_image' || scan.attempts >= MAX_ATTEMPTS
    await ctx.db.patch(scanId, {
      status: terminal ? 'failed' : 'pending',
      error,
      attemptId: undefined,
      startedAt: undefined,
      lastAttempt: {
        attemptId,
        model,
        latencyMs,
        costUsd,
        repairCount,
        failureKind,
        ...(servedProvider === undefined ? {} : { servedProvider }),
      },
    })
    return true
  },
})

export const sweepTickets = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now()
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
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      repairCount: result.repairCount,
      ...(result.servedProvider === undefined
        ? {}
        : { servedProvider: result.servedProvider }),
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
