export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1'

/**
 * What one call cost, whatever became of its answer. Read before any rejection: an answer that
 * cannot be used was billed all the same, and `costReported` is what separates a free call from one
 * whose price the provider did not state — the two used to be the same zero.
 */
export type Billing = {
  servedProvider: string | null
  latencyMs: number
  costUsd: number
  costReported: boolean
}

/**
 * The three ways a call fails before its answer can be read. Both callers' taxonomies already name
 * all three, which is why this module can hand them back unmapped.
 */
export type TransportFailure = 'timeout' | 'transport' | 'truncated'

/** What a caller's decoder says of the parsed answer. `TKind` is its own failure taxonomy. */
export type Decoded<T, TKind extends string> =
  { ok: true; value: T } | { ok: false; kind: TKind; error: string }

export type BilledCall<T, TKind extends string> = Billing &
  (
    | { ok: true; value: T }
    | { ok: false; kind: TKind | TransportFailure; error: string }
  )

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
 * One billed call to OpenRouter: the request goes out under a deadline, the answer comes back under
 * a ceiling, and what it cost is read before anything decides whether it was any use.
 *
 * The two callers — extraction and beautification — had written all of that twice, down to the same
 * abort-versus-transport test and the same "read the price before rejecting" comment, under two
 * names for one measurement record. What genuinely differs between them is the request body and how
 * the answer is read, so those are the two things this takes: `body` and `decode`.
 *
 * `decode` never sees the transport. It receives the parsed answer and nothing else, which is what
 * keeps both decoders testable without a fetch stub.
 */
export async function callOpenRouter<T, TKind extends string>({
  apiKey,
  body,
  decode,
  timeoutMs,
  maxResponseBytes,
  fetchImpl = fetch,
}: {
  apiKey: string
  body: string
  decode: (raw: unknown) => Decoded<T, TKind>
  timeoutMs: number
  maxResponseBytes: number
  fetchImpl?: typeof fetch
}): Promise<BilledCall<T, TKind>> {
  const startedAt = performance.now()
  /** Nothing was served, so nothing was billed — but the wait still happened and is reported. */
  const unbilled = (
    kind: TransportFailure,
    error: string,
  ): BilledCall<T, TKind> => ({
    ok: false,
    kind,
    error,
    servedProvider: null,
    costUsd: 0,
    costReported: false,
    latencyMs: performance.now() - startedAt,
  })

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
      body,
    })
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === 'AbortError'
    return unbilled(
      timedOut ? 'timeout' : 'transport',
      timedOut
        ? 'Délai OpenRouter dépassé'
        : `Transport OpenRouter : ${String(error)}`,
    )
  } finally {
    clearTimeout(timer)
  }

  const read = await readBoundedBody(response, maxResponseBytes)
  if (!read.ok)
    return unbilled('truncated', 'Réponse OpenRouter trop volumineuse')

  let raw: {
    provider?: string
    usage?: { cost?: number }
    error?: { message?: string }
  }
  try {
    raw = JSON.parse(read.text) as typeof raw
  } catch {
    return unbilled(
      'transport',
      `Réponse OpenRouter illisible : HTTP ${response.status}`,
    )
  }

  // Billed even when the answer is unusable, so the price is read before any rejection — and the
  // flag says whether it was reported at all, since a missing price is not a free call.
  const reported = raw.usage?.cost
  const costReported = typeof reported === 'number' && Number.isFinite(reported)
  const billing: Billing = {
    servedProvider: raw.provider ?? null,
    latencyMs: performance.now() - startedAt,
    costUsd: costReported ? reported : 0,
    costReported,
  }

  if (!response.ok)
    return {
      ok: false,
      kind: 'transport',
      // Bounded: an HTML error page pasted whole would bury the journal row that carries it.
      error: `OpenRouter HTTP ${response.status} : ${raw.error?.message ?? read.text.slice(0, 300)}`,
      ...billing,
    }

  const decoded = decode(raw)
  return decoded.ok
    ? { ok: true, value: decoded.value, ...billing }
    : { ok: false, kind: decoded.kind, error: decoded.error, ...billing }
}
