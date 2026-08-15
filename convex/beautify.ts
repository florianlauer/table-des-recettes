import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation } from './_generated/server'
import { renditionPool } from './derivations'
import { deleteStoredBlob } from './lib/blobs'
import { touchedIllustration } from './lib/recipeWrites'
import { clearRendition } from './lib/renditions'
import {
  beautifyFailureKind as beautifyFailureKindValidator,
  beautifyObservation,
  findAttempt,
  journalBeautifyAttempt,
} from './lib/beautifyJournal'
import { literalUnion } from './lib/validators'
import { BEAUTIFY_MODEL, BEAUTIFY_PROMPT } from '../src/shared/beautifyPrompt'
import { beautifyFailureKind } from '../src/shared/beautifyFailureKinds'
import type {
  BeautifyFailureKind,
  DecodeFailureReason,
} from '../src/shared/beautifyFailureKinds'
import { base64ToBytes, bytesToBase64 } from '../src/shared/base64'
import { MAX_INPUT_BYTES, sniffImageHeader } from '../src/shared/imageHeader'

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1'

/** What became of the candidate — the only two answers a finalisation can give. */
const finalizeOutcome = literalUnion(['adopted', 'discarded'] as const)

// The bench allowed 300 s because it was ranking eight models, one of which needed 78 s. Only one
// model survived, measured at 9,1 s; this ceiling bounds a hang and nothing else, and it stays well
// inside what a Convex action is allowed to live for.
export const BEAUTIFY_TIMEOUT_MS = 240_000

// The candidate is an image like any other, so it obeys the same ceiling as an upload.
export const MAX_BEAUTIFIED_BYTES = MAX_INPUT_BYTES
// Base64 inflates by 4/3. Checked against the *encoded* string, before a single byte is decoded.
export const MAX_BASE64_CHARS = Math.ceil((MAX_BEAUTIFIED_BYTES * 4) / 3) + 4
// The whole HTTP body: the data URI plus the JSON around it. A megabyte of slack covers the
// envelope — `usage`, `provider`, any trailing prose.
export const MAX_RESPONSE_BYTES = MAX_BASE64_CHARS + 1024 * 1024

type BeautifyEnvironment = { OPENROUTER_API_KEY?: string }

type OpenRouterImageResponse = {
  provider?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      refusal?: string | null
      images?: Array<{ image_url?: { url?: string } }>
    }
  }>
  usage?: { cost?: number }
  error?: { message?: string }
}

type Observation = {
  model: string
  servedProvider: string | null
  latencyMs: number
  costUsd: number
  costReported: boolean
}

export type BeautifyResult =
  | ({
      ok: true
      bytes: Uint8Array<ArrayBuffer>
      mediaType: string
    } & Observation)
  | ({ ok: false; kind: BeautifyFailureKind; error: string } & Observation)

type Decoded =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; mediaType: string }
  | { ok: false; kind: BeautifyFailureKind; error: string }

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i

/**
 * Reads the response while bounding it. `response.text()` would already have the whole body in
 * memory before any ceiling could apply, which is exactly how an oversized answer takes the action
 * down instead of being refused by it.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const body = response.body
  // No stream to bound — and nothing to fear either, since there is no body to read.
  if (!body) return { ok: true, text: await response.text() }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false }
    }
    chunks.push(value)
  }
  // Streamed rather than joined then decoded: a UTF-8 sequence can straddle two chunks.
  const decoder = new TextDecoder()
  const text = chunks
    .map((chunk) => decoder.decode(chunk, { stream: true }))
    .join('')
  return { ok: true, text: text + decoder.decode() }
}

/**
 * What the answer contains, with no notion of when it arrived — hence testable without a fetch
 * stub. Three barriers in order: the encoded length before decoding, the decoded size, then the
 * header. The bench's decoder had none of them: it accepted any `data:image/*` of any length.
 */
export function decodeBeautifiedImage(raw: OpenRouterImageResponse): Decoded {
  const failure = (reason: DecodeFailureReason, error: string): Decoded => ({
    ok: false,
    kind: beautifyFailureKind(reason),
    error,
  })

  const choice = raw.choices?.[0]
  const refusal = choice?.message?.refusal
  if (typeof refusal === 'string' && refusal.length > 0)
    return failure('refusal', refusal)

  const url = choice?.message?.images?.[0]?.image_url?.url
  if (typeof url !== 'string') {
    // Truncation is only read once no image came back: a model that emitted its image and then ran
    // out of tokens on trailing prose has still done the job.
    if (choice?.finish_reason === 'length')
      return failure('truncation', 'Réponse tronquée avant l’image')
    const text = choice?.message?.content
    return failure(
      'no_image',
      typeof text === 'string' && text.length > 0
        ? `Réponse en texte, sans image : ${text.slice(0, 300)}`
        : 'Aucune image dans la réponse',
    )
  }

  const match = DATA_URI.exec(url)
  if (!match?.[1] || !match[2])
    return failure(
      'no_image',
      `URL d’image non décodable : ${url.slice(0, 120)}`,
    )
  if (match[2].length > MAX_BASE64_CHARS)
    return failure('truncation', 'Image produite trop volumineuse')

  const bytes = base64ToBytes(match[2])
  const header = sniffImageHeader({ bytes, fileSize: bytes.length })
  if (!header.ok)
    return { ok: false, kind: 'invalid_image', error: header.message }
  return { ok: true, bytes, mediaType: match[1] }
}

/**
 * One billed call. Everything it can refuse, it refuses before spending: a missing blob or an
 * unreadable header costs nothing, and the ceiling on the answer applies while it is being read.
 */
export async function beautifyImage({
  blob,
  environment = process.env,
  fetchImpl = fetch,
  timeoutMs = BEAUTIFY_TIMEOUT_MS,
}: {
  blob: Blob | null
  environment?: BeautifyEnvironment
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<BeautifyResult> {
  const startedAt = performance.now()
  const idle = {
    model: BEAUTIFY_MODEL,
    servedProvider: null,
    costUsd: 0,
    costReported: false,
  }
  const refuse = (
    kind: BeautifyFailureKind,
    error: string,
  ): BeautifyResult => ({
    ok: false,
    kind,
    error,
    ...idle,
    latencyMs: performance.now() - startedAt,
  })

  const apiKey = environment.OPENROUTER_API_KEY ?? ''
  if (!apiKey) return refuse('transport', 'Configuration OpenRouter incomplète')
  if (!blob) return refuse('invalid_image', 'Image source introuvable')

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const header = sniffImageHeader({ bytes, fileSize: blob.size })
  if (!header.ok) return refuse('invalid_image', header.message)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetchImpl(`${OPENROUTER_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: BEAUTIFY_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: BEAUTIFY_PROMPT },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/${header.format};base64,${bytesToBase64(bytes)}`,
                },
              },
            ],
          },
        ],
        // Without this an image-capable model answers in words.
        modalities: ['image', 'text'],
        usage: { include: true },
      }),
    })
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === 'AbortError'
    return refuse(
      timedOut ? 'timeout' : 'transport',
      timedOut
        ? 'Délai OpenRouter dépassé'
        : `Transport OpenRouter : ${String(error)}`,
    )
  } finally {
    clearTimeout(timer)
  }

  const read = await readBoundedBody(response, MAX_RESPONSE_BYTES)
  if (!read.ok)
    return refuse('truncated', 'Réponse OpenRouter trop volumineuse')

  let raw: OpenRouterImageResponse
  try {
    raw = JSON.parse(read.text) as OpenRouterImageResponse
  } catch {
    return refuse(
      'transport',
      `Réponse OpenRouter illisible : HTTP ${response.status}`,
    )
  }

  // Billed even when the answer is unusable, so the price is read before any rejection — and the
  // flag says whether it was reported at all, since a missing one is not a free call.
  const reportedCost = raw.usage?.cost
  const costReported =
    typeof reportedCost === 'number' && Number.isFinite(reportedCost)
  const observation: Observation = {
    model: BEAUTIFY_MODEL,
    servedProvider: raw.provider ?? null,
    latencyMs: performance.now() - startedAt,
    costUsd: costReported ? reportedCost : 0,
    costReported,
  }

  if (!response.ok) {
    return {
      ok: false,
      kind: 'transport',
      error: `OpenRouter HTTP ${response.status} : ${raw.error?.message ?? read.text.slice(0, 300)}`,
      ...observation,
    }
  }
  const decoded = decodeBeautifiedImage(raw)
  return decoded.ok
    ? {
        ok: true,
        bytes: decoded.bytes,
        mediaType: decoded.mediaType,
        ...observation,
      }
    : { ok: false, kind: decoded.kind, error: decoded.error, ...observation }
}

export const render = internalAction({
  args: {
    recipeId: v.id('recipes'),
    attemptId: v.string(),
    sourceStorageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, { recipeId, attemptId, sourceStorageId }) => {
    const blob = await ctx.storage.get(sourceStorageId)
    const result = await beautifyImage({ blob })
    const observation = {
      attemptId,
      model: result.model,
      servedProvider: result.servedProvider,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      costReported: result.costReported,
    }
    if (!result.ok) {
      await ctx.runMutation(internal.beautify.recordBeautifyFailure, {
        ...observation,
        recipeId,
        sourceStorageId,
        failureKind: result.kind,
        error: result.error,
      })
      return null
    }
    // Stored before the mutation runs, because a mutation cannot store bytes. If the finalisation
    // then refuses the candidate, it is that same transaction which deletes it.
    const candidateStorageId = await ctx.storage.store(
      new Blob([result.bytes], { type: result.mediaType }),
    )
    await ctx.runMutation(internal.beautify.finalizeBeautify, {
      ...observation,
      recipeId,
      sourceStorageId,
      candidateStorageId,
    })
    return null
  },
})

/**
 * Adopts the candidate, or destroys it — in one transaction, so no crash can land between "the
 * journal says discarded" and "the blob is gone".
 *
 * The replay check comes first, before any guard. A second finalisation of the same attempt no
 * longer satisfies `generating` — the first one moved the recipe to `review` — so the staleness
 * rule below would read it as late and delete a candidate the recipe now points at.
 */
export const finalizeBeautify = internalMutation({
  args: {
    ...beautifyObservation,
    recipeId: v.id('recipes'),
    sourceStorageId: v.id('_storage'),
    candidateStorageId: v.id('_storage'),
  },
  returns: finalizeOutcome,
  handler: async (
    ctx,
    { recipeId, sourceStorageId, candidateStorageId, ...observation },
  ) => {
    const recipe = await ctx.db.get('recipes', recipeId)
    if (await findAttempt(ctx, observation.attemptId)) {
      // Already settled. Only a blob the recipe does not point at can be a second render's, and
      // only that one may be destroyed.
      if (recipe?.beautifiedStorageId === candidateStorageId) return 'adopted'
      await deleteStoredBlob(ctx, candidateStorageId)
      return 'discarded'
    }

    // The attempt id alone would not do — it survives the write. Requiring `generating` consumes
    // the attempt, and comparing the source refuses a candidate rendered from an image that has
    // since been replaced.
    const stale =
      !recipe ||
      recipe.beautifyStatus !== 'generating' ||
      recipe.beautifyAttemptId !== observation.attemptId ||
      recipe.imageStorageId !== sourceStorageId
    if (stale) {
      await deleteStoredBlob(ctx, candidateStorageId)
      await journalBeautifyAttempt(ctx, {
        ...observation,
        recipeId,
        sourceStorageId,
        outcome: 'discarded',
        failureKind: null,
      })
      return 'discarded'
    }

    // The candidate replaces whatever the slot held, so its predecessor's derivative goes too.
    const cleared = await clearRendition(ctx, recipe, 'beautified')
    await ctx.db.patch(recipeId, {
      beautifiedStorageId: candidateStorageId,
      ...cleared,
      beautifyStatus: 'review',
      beautifyStartedAt: undefined,
      beautifyError: undefined,
      ...touchedIllustration(Date.now()),
    })
    await journalBeautifyAttempt(ctx, {
      ...observation,
      recipeId,
      sourceStorageId,
      outcome: 'pending',
      failureKind: null,
    })
    // Only on the branch that adopts: a discarded candidate has no display to derive for.
    await renditionPool.enqueueAction(ctx, internal.derive.deriveRendition, {
      recipeId,
      slot: 'beautified',
      sourceStorageId: candidateStorageId,
    })
    return 'adopted'
  },
})

export const recordBeautifyFailure = internalMutation({
  args: {
    ...beautifyObservation,
    recipeId: v.id('recipes'),
    sourceStorageId: v.id('_storage'),
    failureKind: beautifyFailureKindValidator,
    error: v.string(),
  },
  returns: v.boolean(),
  handler: async (
    ctx,
    { recipeId, sourceStorageId, failureKind, error, ...observation },
  ) => {
    // Journalled whatever the recipe now looks like: the call was billed. `outcome: 'discarded'`
    // with a `failureKind` is the technical failure; nothing was ever there to arbitrate.
    const journalled = await journalBeautifyAttempt(ctx, {
      ...observation,
      recipeId,
      sourceStorageId,
      outcome: 'discarded',
      failureKind,
    })
    if (!journalled) return false

    const recipe = await ctx.db.get('recipes', recipeId)
    if (
      !recipe ||
      recipe.beautifyStatus !== 'generating' ||
      recipe.beautifyAttemptId !== observation.attemptId
    )
      return false
    await ctx.db.patch(recipeId, {
      beautifyStatus: 'failed',
      beautifyError: error,
      beautifyAttemptId: undefined,
      beautifyStartedAt: undefined,
      ...touchedIllustration(Date.now()),
    })
    return true
  },
})
