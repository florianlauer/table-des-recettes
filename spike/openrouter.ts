import { readFile } from 'node:fs/promises'

import {
  extractionSchema,
  repairExtraction,
  RECIPE_SCHEMA_VERSION,
} from '../src/shared/recipe-schema.js'
import type { Extraction, SchemaRepair } from '../src/shared/recipe-schema.js'
import type { BudgetCounter } from './budget.js'
import { extractionJsonSchema, JSON_SCHEMA_NAME } from './json-schema.js'
import { EXTRACTION_PROMPT, PROMPT_VERSION } from './prompt.js'

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1'
export const MAX_OUTPUT_TOKENS = 8000
export const REQUEST_TIMEOUT_MS = 120_000
export const MAX_ATTEMPTS = 3

type Fetch = typeof fetch

type OpenRouterResponse = {
  provider?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: string | null; refusal?: string | null }
  }>
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
  [key: string]: unknown
}

export type PassSuccess = {
  status: 'success'
  parsed: Extraction
  raw: OpenRouterResponse
  attempts: number
  latencyMs: number
  actualCostUsd: number
  servedProvider: string
  // Une passe réparée reste un succès, mais elle n'est pas de la même qualité qu'une passe conforme :
  // sans cette trace, les deux seraient indiscernables dans les artefacts.
  repairs: SchemaRepair[]
}

export type PassFailure = {
  status: 'failure'
  reason: 'refusal' | 'truncation' | 'invalid_schema' | 'unsupported_request'
  detail: string
  raw?: OpenRouterResponse
  attempts: number
  latencyMs: number
  actualCostUsd: number
}

export type PassInconclusive = {
  status: 'inconclusive'
  reason: 'transient_error'
  detail: string
  attempts: number
  latencyMs: number
  actualCostUsd: number
}

export type PassResult = PassSuccess | PassFailure | PassInconclusive

export class HarnessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HarnessError'
  }
}

export function requireOpenRouterApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = env.OPENROUTER_API_KEY
  if (!key) {
    throw new Error(
      'OPENROUTER_API_KEY manque. Renseignez .env.local avec une clé OpenRouter valide avant tout appel payant.',
    )
  }
  return key
}

function isTransientMessage(message: string): boolean {
  return /no provider available|rate.?limit|temporar|timeout|timed out|overloaded/i.test(
    message,
  )
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function isUnsupportedRequest({
  status,
  message,
}: {
  status: number
  message: string
}): boolean {
  if (![400, 404, 422].includes(status)) return false
  const namesCapability =
    /structured[\s_-]*outputs?|response[\s_-]*format|json[\s_-]*schema|parameter|image|vision|modality/i.test(
      message,
    )
  const rejectsCapability =
    /not support(?:ed|ing)?|isn['’]?t supported|does not support|doesn['’]?t support|unsupported|cannot support|can['’]?t support|unknown parameter|invalid parameter/i.test(
      message,
    )
  return namesCapability && rejectsCapability
}

function actualCost(raw: OpenRouterResponse): number | null {
  return typeof raw.usage?.cost === 'number' && Number.isFinite(raw.usage.cost)
    ? raw.usage.cost
    : null
}

const MANDATORY_REASONING = /reasoning is mandatory/i

export function normalizeProviderIdentifier(provider: string): string {
  return provider.toLocaleLowerCase('en').replace(/[\s_-]/g, '')
}
type UserContent = string | Array<Record<string, unknown>>

type Answered = {
  status: 'answered'
  raw: OpenRouterResponse
  content: string
  attempts: number
  latencyMs: number
  actualCostUsd: number
  servedProvider: string
}

/** Everything the transport can conclude on its own, without reading the answer's content. */
export type TransportResult = Answered | PassFailure | PassInconclusive

export type EndpointCall = {
  model: string
  providerSlug: string
  // The response returns the display name ("Google"), never the routing slug ("google-vertex").
  providerName: string
  apiKey: string
  budget: BudgetCounter
  maximumEstimatedCostUsd: number
  // Reasoning models reject `temperature` instead of ignoring it: sending it turns a capable endpoint
  // into a 400. Their determinism comes from the model, not from the parameter.
  supportsTemperature?: boolean
  // Transcribing a page is a reading task, not a puzzle, and a model that thinks freely truncates its
  // own answer. `effort: "low"` is measurably a no-op — alibaba returned *more* reasoning tokens with
  // it than without — so the only lever that works is switching reasoning off. Endpoints that make it
  // mandatory answer 400, and the call replays without the field.
  disableReasoning?: boolean
  maxTokens?: number
  fetchImpl?: Fetch
  sleep?: (milliseconds: number) => Promise<void>
  timeoutMs?: number
  onCostRecorded?: () => Promise<void>
}

// The single place that talks to OpenRouter. Both the extraction pass and the correction pass go
// through it, so budget discipline, retries, provider attribution and the infrastructure-versus-model
// split are written once. A second client would inherit none of them: `runCorrectionPass` used to be
// one, and it silently sent `temperature` to endpoints that answer 400 to it.
async function callEndpoint({
  content,
  model,
  providerSlug,
  providerName,
  apiKey,
  budget,
  maximumEstimatedCostUsd,
  supportsTemperature = true,
  disableReasoning = false,
  maxTokens = MAX_OUTPUT_TOKENS,
  fetchImpl = fetch,
  sleep = (milliseconds: number) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  timeoutMs = REQUEST_TIMEOUT_MS,
  onCostRecorded = async () => undefined,
}: EndpointCall & { content: UserContent }): Promise<TransportResult> {
  const startedAt = performance.now()
  let totalCost = 0
  let lastTransient = 'Erreur transitoire inconnue'
  let reasoningOff = disableReasoning

  // Charging happens before any classification and is persisted on the spot: a `HarnessError` thrown
  // afterwards must never leave a spend counted in memory and absent from disk.
  const charge = async (amount: number): Promise<void> => {
    budget.record(amount)
    totalCost += amount
    await onCostRecorded()
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    budget.assertCanSpend(maximumEstimatedCostUsd)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
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
            messages: [{ role: 'user', content }],
            ...(supportsTemperature ? { temperature: 0 } : {}),
            ...(reasoningOff ? { reasoning: { enabled: false } } : {}),
            max_tokens: maxTokens,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: JSON_SCHEMA_NAME,
                strict: true,
                schema: extractionJsonSchema,
              },
            },
            provider: {
              only: [providerSlug],
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
        raw = { error: { message: responseText || `HTTP ${response.status}` } }
      }
      const errorMessage = raw.error?.message ?? responseText
      const reportedCost = actualCost(raw)

      if (!response.ok) {
        if (reportedCost !== null) await charge(reportedCost)
        // Refusing to switch reasoning off says nothing about the model's ability to read a page:
        // the request is simply replayed as it would have been sent without the field.
        if (reasoningOff && MANDATORY_REASONING.test(errorMessage)) {
          reasoningOff = false
          attempt -= 1
          continue
        }
        if (
          isTransientStatus(response.status) ||
          isTransientMessage(errorMessage)
        ) {
          lastTransient = `HTTP ${response.status}: ${errorMessage}`
          if (attempt < MAX_ATTEMPTS) {
            await sleep(250 * 2 ** (attempt - 1))
            continue
          }
          break
        }
        if (
          isUnsupportedRequest({
            status: response.status,
            message: errorMessage,
          })
        ) {
          return {
            status: 'failure',
            reason: 'unsupported_request',
            detail: `HTTP ${response.status}: ${errorMessage}`,
            raw,
            attempts: attempt,
            latencyMs: performance.now() - startedAt,
            actualCostUsd: totalCost,
          }
        }
        // An unattributable error stops the run, so the worst case is charged first: the walk states
        // that every `HarnessError` it absorbs has already been paid for, and that has to be true.
        if (reportedCost === null) await charge(maximumEstimatedCostUsd)
        throw new HarnessError(
          `Erreur OpenRouter non évaluable — HTTP ${response.status}: ${errorMessage}`,
        )
      }

      await charge(reportedCost ?? maximumEstimatedCostUsd)
      if (reportedCost === null) {
        throw new HarnessError(
          `usage.cost absent ; ${maximumEstimatedCostUsd} USD imputé par prudence. Arrêt du harnais.`,
        )
      }
      if (
        typeof raw.provider !== 'string' ||
        normalizeProviderIdentifier(raw.provider) !==
          normalizeProviderIdentifier(providerName)
      ) {
        throw new HarnessError(
          `Provider demandé ${providerSlug} (${providerName}), servi ${String(raw.provider)}. Arrêt du harnais.`,
        )
      }

      const settled = {
        raw,
        attempts: attempt,
        latencyMs: performance.now() - startedAt,
        actualCostUsd: totalCost,
      }
      const choice = raw.choices?.[0]
      if (choice?.message?.refusal) {
        return {
          status: 'failure',
          reason: 'refusal',
          detail: choice.message.refusal,
          ...settled,
        }
      }
      if (choice?.finish_reason !== 'stop') {
        return {
          status: 'failure',
          reason: 'truncation',
          detail: `finish_reason=${String(choice?.finish_reason)}`,
          ...settled,
        }
      }
      return {
        status: 'answered',
        content: choice.message?.content ?? '',
        servedProvider: raw.provider,
        ...settled,
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      if (
        error instanceof TypeError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        lastTransient = message
        if (attempt < MAX_ATTEMPTS) {
          await sleep(250 * 2 ** (attempt - 1))
          continue
        }
        break
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    status: 'inconclusive',
    reason: 'transient_error',
    detail: lastTransient,
    attempts: MAX_ATTEMPTS,
    latencyMs: performance.now() - startedAt,
    actualCostUsd: totalCost,
  }
}

/** Parse the answer as an extraction, repairing a string in a numeric field before validating. */
export function readExtraction(
  answered: Answered,
):
  | { ok: true; parsed: Extraction; repairs: SchemaRepair[] }
  | { ok: false; detail: string } {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(answered.content)
  } catch (error) {
    return { ok: false, detail: `JSON invalide : ${String(error)}` }
  }
  const { value, repairs } = repairExtraction(parsedJson)
  const validated = extractionSchema.safeParse(value)
  return validated.success
    ? { ok: true, parsed: validated.data, repairs }
    : { ok: false, detail: validated.error.message }
}

export async function runVisionPass({
  imagePath,
  dataCollection: _dataCollection,
  ...call
}: EndpointCall & {
  imagePath: string
  dataCollection: string | null
}): Promise<PassResult> {
  const image = await readFile(imagePath)
  const contentType = imagePath.toLowerCase().endsWith('.png')
    ? 'image/png'
    : 'image/jpeg'
  const transported = await callEndpoint({
    ...call,
    content: [
      { type: 'text', text: EXTRACTION_PROMPT },
      {
        type: 'image_url',
        image_url: {
          url: `data:${contentType};base64,${image.toString('base64')}`,
        },
      },
    ],
  })
  if (transported.status !== 'answered') return transported

  const read = readExtraction(transported)
  const { raw, attempts, latencyMs, actualCostUsd, servedProvider } =
    transported
  return read.ok
    ? {
        status: 'success',
        parsed: read.parsed,
        raw,
        attempts,
        latencyMs,
        actualCostUsd,
        servedProvider,
        repairs: read.repairs,
      }
    : {
        status: 'failure',
        reason: 'invalid_schema',
        detail: read.detail,
        raw,
        attempts,
        latencyMs,
        actualCostUsd,
      }
}

/** Send an already-built prompt through the shared transport and return the raw answer. */
export async function askEndpoint(
  call: EndpointCall & { content: UserContent },
): Promise<TransportResult> {
  return callEndpoint(call)
}

export function serializeRun({
  result,
  model,
  providerSlug,
  page,
  pass,
  dataCollection,
}: {
  result: PassResult
  model: string
  providerSlug: string
  page: string
  pass: number
  dataCollection: string | null
}): Record<string, unknown> {
  return {
    model,
    requestedProvider: providerSlug,
    page,
    pass,
    promptVersion: PROMPT_VERSION,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    dataCollection,
    ...result,
  }
}
