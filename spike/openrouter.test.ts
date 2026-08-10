import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { BudgetCounter } from './budget.js'
import { HarnessError, runVisionPass } from './openrouter.js'

const validExtraction = {
  recipes: [
    {
      title: 'Soupe',
      type: 'entree',
      servings: null,
      ingredients: [
        { raw: 'Une carotte', quantity: null, unit: null, label: null },
      ],
      ingredientsInferred: false,
      steps: ['Cuire.'],
    },
  ],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function successBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    provider: 'provider-a',
    choices: [
      {
        finish_reason: 'stop',
        message: { content: JSON.stringify(validExtraction) },
      },
    ],
    usage: { cost: 0.001 },
    ...overrides,
  }
}

describe('OpenRouter call classification', () => {
  let imagePath: string
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'spike-t1-openrouter-'))
    imagePath = resolve(directory, 'page.jpg')
    await writeFile(imagePath, 'jpeg simulé')
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function execute({
    fetchImpl,
    providerSlug = 'provider-a',
    providerName = 'Provider A',
    budget = new BudgetCounter(),
    disableReasoning = false,
    onCostRecorded,
  }: {
    fetchImpl: typeof fetch
    providerSlug?: string
    providerName?: string
    budget?: BudgetCounter
    disableReasoning?: boolean
    onCostRecorded?: () => Promise<void>
  }) {
    return runVisionPass({
      model: 'author/model',
      providerSlug,
      providerName,
      imagePath,
      apiKey: 'test-key',
      budget,
      maximumEstimatedCostUsd: 0.01,
      dataCollection: null,
      disableReasoning,
      ...(onCostRecorded ? { onCostRecorded } : {}),
      fetchImpl,
      sleep: async () => undefined,
      timeoutMs: 10,
    })
  }

  it.each([
    ['429', () => jsonResponse({ error: { message: 'rate limited' } }, 429)],
    ['5xx', () => jsonResponse({ error: { message: 'overloaded' } }, 500)],
    [
      'no provider available',
      () => jsonResponse({ error: { message: 'No provider available' } }, 400),
    ],
    [
      'timeout',
      () => Promise.reject(new DOMException('timed out', 'AbortError')),
    ],
  ])(
    'retries %s three times then classifies the pass as inconclusive',
    async (_label, responseFactory) => {
      const fetchMock = vi.fn(responseFactory) as unknown as typeof fetch
      const result = await execute({ fetchImpl: fetchMock })
      expect(result.status).toBe('inconclusive')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    },
  )

  it.each([
    [
      'refusal',
      successBody({
        choices: [{ finish_reason: 'stop', message: { refusal: 'non' } }],
      }),
      'refusal',
    ],
    [
      'truncation',
      successBody({
        choices: [{ finish_reason: 'length', message: { content: '{}' } }],
      }),
      'truncation',
    ],
    [
      'invalid Zod',
      successBody({
        choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
      }),
      'invalid_schema',
    ],
  ])(
    'classifies %s as a failure without retrying',
    async (_label, body, reason) => {
      const fetchMock = vi.fn(async () =>
        jsonResponse(body),
      ) as unknown as typeof fetch
      const result = await execute({ fetchImpl: fetchMock })
      expect(result).toMatchObject({ status: 'failure', reason })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    [400, 'structured outputs is not supported by this provider'],
    [404, 'model not supporting the requested modality: image'],
    [422, 'unsupported parameter: response_format'],
  ])(
    'classifies an HTTP %s capability refusal as a rung failure without retrying',
    async (status, message) => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ error: { message } }, status),
      ) as unknown as typeof fetch
      await expect(execute({ fetchImpl: fetchMock })).resolves.toMatchObject({
        status: 'failure',
        reason: 'unsupported_request',
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  // An endpoint that makes reasoning mandatory answers 400 to `reasoning: {enabled: false}`. That
  // says nothing about its ability to read a page, so the field is dropped and the call replayed —
  // and the replay must not eat one of the three attempts reserved for transient errors.
  it('replays without the reasoning field when the endpoint makes it mandatory', async () => {
    const bodies = [
      () =>
        jsonResponse(
          {
            error: {
              message:
                'Reasoning is mandatory for this endpoint and cannot be disabled.',
            },
          },
          400,
        ),
      () => jsonResponse(successBody()),
    ]
    const sent: unknown[] = []
    const fetchMock = vi.fn(async (_url: unknown, init: { body: string }) => {
      sent.push(JSON.parse(init.body))
      return bodies[sent.length - 1]!()
    }) as unknown as typeof fetch

    const result = await execute({
      fetchImpl: fetchMock,
      disableReasoning: true,
    })

    expect(result.status).toBe('success')
    expect(sent).toHaveLength(2)
    expect(sent[0]).toHaveProperty('reasoning', { enabled: false })
    expect(sent[1]).not.toHaveProperty('reasoning')
    expect((result as { attempts: number }).attempts).toBe(1)
  })

  it('halts the harness when the cost is missing but still charges the estimate', async () => {
    const body = successBody()
    delete (body.usage as Record<string, unknown>).cost
    const fetchMock = vi.fn(async () =>
      jsonResponse(body),
    ) as unknown as typeof fetch
    const budget = new BudgetCounter()
    await expect(execute({ fetchImpl: fetchMock, budget })).rejects.toThrow(
      HarnessError,
    )
    expect(budget.spent).toBe(0.01)
  })

  it('accepts the served display name up to case and separators', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(successBody({ provider: 'DeepInfra' })),
    ) as unknown as typeof fetch
    await expect(
      execute({
        fetchImpl: fetchMock,
        providerSlug: 'deepinfra',
        providerName: 'DeepInfra',
      }),
    ).resolves.toMatchObject({ status: 'success' })
  })

  // The routing slug and the served name genuinely differ at Google: comparing the response against
  // the slug would fail every call on those endpoints.
  it('accepts a display name that looks nothing like the routing slug', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(successBody({ provider: 'Google' })),
    ) as unknown as typeof fetch
    await expect(
      execute({
        fetchImpl: fetchMock,
        providerSlug: 'google-vertex',
        providerName: 'Google',
      }),
    ).resolves.toMatchObject({ status: 'success' })
  })

  it('halts the harness on a genuinely different provider after recording the cost', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(successBody({ provider: 'Together AI' })),
    ) as unknown as typeof fetch
    const budget = new BudgetCounter()
    await expect(
      execute({
        fetchImpl: fetchMock,
        providerSlug: 'deepinfra',
        providerName: 'DeepInfra',
        budget,
      }),
    ).rejects.toThrow(HarnessError)
    expect(budget.spent).toBe(0.001)
  })

  it.each([
    [401, 'unauthorized'],
    [400, 'invalid request payload'],
  ])(
    'halts the harness on an HTTP %s error that is ambiguous or caused by the setup',
    async (status, message) => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ error: { message } }, status),
      ) as unknown as typeof fetch
      await expect(execute({ fetchImpl: fetchMock })).rejects.toThrow(
        HarnessError,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  // A `HarnessError` stops the run, so nothing downstream will save the counter: the charge has to be
  // both imputed and persisted before the throw, or the spend vanishes with the process.
  it('charges and persists the estimate before halting on an error without a reported cost', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'unauthorized' } }, 401),
    ) as unknown as typeof fetch
    const budget = new BudgetCounter()
    const persisted: number[] = []
    await expect(
      execute({
        fetchImpl: fetchMock,
        budget,
        onCostRecorded: async () => {
          persisted.push(budget.spent)
        },
      }),
    ).rejects.toThrow(HarnessError)
    expect(budget.spent).toBe(0.01)
    expect(persisted).toEqual([0.01])
  })

  // Deliberate: a transient failure that OpenRouter reports no cost for is free, and imputing the
  // ceiling for each of the three attempts would spend 0.03 USD of budget on nothing. The hard cap
  // stays safe because `assertCanSpend` runs before every attempt, not because failures are charged.
  it('leaves the budget untouched when a retried failure reports no cost', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: 'rate limited' } }, 429),
    ) as unknown as typeof fetch
    const budget = new BudgetCounter()
    const persisted: number[] = []
    const result = await execute({
      fetchImpl: fetchMock,
      budget,
      onCostRecorded: async () => {
        persisted.push(budget.spent)
      },
    })
    expect(result).toMatchObject({ status: 'inconclusive', actualCostUsd: 0 })
    expect(budget.spent).toBe(0)
    expect(persisted).toEqual([])
  })

  // A capability refusal is a verdict on the rung, and the endpoint does bill the tokens it read.
  it('charges the reported cost of a capability refusal', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: { message: 'unsupported parameter: response_format' },
          usage: { cost: 0.0002 },
        },
        422,
      ),
    ) as unknown as typeof fetch
    const budget = new BudgetCounter()
    const result = await execute({ fetchImpl: fetchMock, budget })
    expect(result).toMatchObject({
      status: 'failure',
      reason: 'unsupported_request',
      actualCostUsd: 0.0002,
    })
    expect(budget.spent).toBe(0.0002)
  })
})
