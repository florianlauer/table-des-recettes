#!/usr/bin/env node
import 'dotenv/config'

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BudgetCounter } from './budget.js'
import {
  HarnessError,
  requireOpenRouterApiKey,
  runVisionPass,
  serializeRun,
} from './openrouter.js'
import type { PassResult } from './openrouter.js'
import type { LadderEntry, LadderFile } from './rank-endpoints.js'
import { parseNamedArguments } from './run.js'

// La sonde tourne sur B, pas sur A : A ne discrimine pas. ministral-3b l'a passée proprement — 8
// étapes, texte intact — avant que B ne révèle qu'il tronque la ligne d'ingrédient à l'abréviation,
// six fois. B teste d'un seul appel la segmentation en quatre recettes, les en-têtes de pays, les
// ingrédients en flux abrégés et la prose non puçée.
export const PROBE_PAGE = 'b'

// Plancher calé sur un débit minimal de 85 tokens/s, en dessous duquel une page dense frôle le
// timeout de 120 s : darkbloom rendait 10 à 29 tokens/s et n'a jamais pu être jugé. B pèse ~3400
// tokens de sortie contre ~850 pour A, d'où 40 s là où A demandait 10 s. C'est un critère de
// faisabilité du protocole, pas un jugement sur la qualité du modèle.
export const DEFAULT_MAX_LATENCY_SECONDS = 40

export type RungDecision =
  | { verdict: 'retenu'; latencySeconds: number }
  | { verdict: 'trop_lent'; latencySeconds: number }
  | { verdict: 'echec_modele'; detail: string }
  | { verdict: 'inconcluant'; detail: string }
  | { verdict: 'non_mesurable'; detail: string }

export function decideRung({
  result,
  maximumLatencySeconds,
}: {
  result: PassResult
  maximumLatencySeconds: number
}): RungDecision {
  if (result.status === 'inconclusive') {
    return { verdict: 'inconcluant', detail: result.detail }
  }
  if (result.status === 'failure') {
    return {
      verdict: 'echec_modele',
      detail: `${result.reason} : ${result.detail}`,
    }
  }
  const latencySeconds = result.latencyMs / 1000
  return latencySeconds > maximumLatencySeconds
    ? { verdict: 'trop_lent', latencySeconds }
    : { verdict: 'retenu', latencySeconds }
}

// `unsupported_request` accuse l'endpoint, tout le reste accuse le modèle : seul le second cas
// justifie d'écarter les autres endpoints du même modèle.
export function condemnsWholeModel(result: PassResult): boolean {
  return result.status === 'failure' && result.reason !== 'unsupported_request'
}

export async function loadCondemnedModels(
  path: string,
): Promise<Map<string, string>> {
  try {
    const entries = JSON.parse(await readFile(path, 'utf8')) as Array<{
      model: string
      reason: string
    }>
    return new Map(entries.map(({ model, reason }) => [model, reason]))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw new Error(
      `Liste des modèles condamnés illisible (${path}) : ${String(error)}`,
    )
  }
}

async function alreadyProbed({
  model,
  providerSlug,
}: {
  model: string
  providerSlug: string
}): Promise<boolean> {
  try {
    const files = await readdir(
      resolve('spike/fixtures/runs', model, providerSlug),
    )
    return files.length > 0
  } catch {
    return false
  }
}

async function latestLadder(): Promise<LadderFile> {
  const latest = (await readdir('spike'))
    .filter((entry) => /^ladder\.\d{4}-\d{2}-\d{2}\.json$/.test(entry))
    .sort()
    .at(-1)
  if (!latest)
    throw new Error("Aucune échelle figée. Exécutez d'abord npm run rank.")
  return JSON.parse(
    await readFile(resolve('spike', latest), 'utf8'),
  ) as LadderFile
}

async function writeHarnessFailure({
  endpoint,
  message,
}: {
  endpoint: LadderEntry
  message: string
}): Promise<void> {
  const directory = resolve(
    'spike/fixtures/runs',
    endpoint.model,
    endpoint.providerSlug,
  )
  await mkdir(directory, { recursive: true })
  await writeFile(
    resolve(directory, `${PROBE_PAGE}-sonde.json`),
    `${JSON.stringify(
      {
        model: endpoint.model,
        requestedProvider: endpoint.providerSlug,
        page: PROBE_PAGE,
        status: 'harness_error',
        detail: message,
      },
      null,
      2,
    )}\n`,
  )
}

async function probeRung({
  endpoint,
  apiKey,
  budget,
  budgetPath,
}: {
  endpoint: LadderEntry
  apiKey: string
  budget: BudgetCounter
  budgetPath: string
}): Promise<PassResult> {
  const result = await runVisionPass({
    model: endpoint.model,
    providerSlug: endpoint.providerSlug,
    providerName: endpoint.providerName,
    imagePath: resolve(`spike/fixtures/pages/${PROBE_PAGE}.jpg`),
    apiKey,
    budget,
    maximumEstimatedCostUsd: endpoint.maximumCallCostUsd,
    dataCollection: endpoint.dataCollection,
    supportsTemperature: endpoint.supportsTemperature,
    disableReasoning: endpoint.supportsReasoning,
    onCostRecorded: () => budget.save(budgetPath),
  })
  await budget.save(budgetPath)
  const directory = resolve(
    'spike/fixtures/runs',
    endpoint.model,
    endpoint.providerSlug,
  )
  await mkdir(directory, { recursive: true })
  await writeFile(
    resolve(directory, `${PROBE_PAGE}-sonde.json`),
    `${JSON.stringify(
      serializeRun({
        result,
        model: endpoint.model,
        providerSlug: endpoint.providerSlug,
        page: PROBE_PAGE,
        pass: 0,
        dataCollection: endpoint.dataCollection,
      }),
      null,
      2,
    )}\n`,
  )
  return result
}

async function main(): Promise<void> {
  const {
    from = '2',
    'max-latency': maxLatency = String(DEFAULT_MAX_LATENCY_SECONDS),
    limit = '12',
  } = parseNamedArguments(process.argv.slice(2))
  const startRank = Number(from)
  const maximumLatencySeconds = Number(maxLatency)
  const maximumRungs = Number(limit)
  if (!Number.isInteger(startRank) || startRank < 1)
    throw new Error('--from attend un rang entier ≥ 1.')
  if (!(maximumLatencySeconds > 0))
    throw new Error('--max-latency attend un nombre de secondes > 0.')
  if (!Number.isInteger(maximumRungs) || maximumRungs < 1)
    throw new Error('--limit attend un entier ≥ 1.')

  const apiKey = requireOpenRouterApiKey()
  const ladder = await latestLadder()
  const condemned = await loadCondemnedModels(resolve('spike/condemned.json'))
  const budgetPath = resolve('spike/fixtures/runs/budget.json')
  await mkdir(resolve(budgetPath, '..'), { recursive: true })
  const budget = await BudgetCounter.load({ path: budgetPath })

  console.log(
    `Marche depuis le rang ${startRank}, plancher de latence ${maximumLatencySeconds} s sur la page ${PROBE_PAGE.toUpperCase()}, ${maximumRungs} barreaux au plus.`,
  )

  let probed = 0
  for (
    let index = startRank - 1;
    index < ladder.ladder.length && probed < maximumRungs;
    index += 1
  ) {
    const endpoint = ladder.ladder[index]
    if (!endpoint) break
    const rank = index + 1
    const label = `rang ${rank} ${endpoint.providerSlug} / ${endpoint.model}`

    const condemnedReason = condemned.get(endpoint.model)
    if (condemnedReason) {
      console.log(`${label} — sauté : modèle condamné (${condemnedReason})`)
      continue
    }
    if (await alreadyProbed(endpoint)) {
      console.log(`${label} — sauté : déjà joué, résultats sur disque`)
      continue
    }

    probed += 1
    let result: PassResult | null = null
    let decision: RungDecision
    try {
      result = await probeRung({ endpoint, apiKey, budget, budgetPath })
      decision = decideRung({ result, maximumLatencySeconds })
    } catch (error) {
      // La marche trie des endpoints, elle ne juge aucun modèle, et l'imputation au pire cas a déjà
      // eu lieu avant que le harnais ne jette : un coût illisible disqualifie donc cet endpoint au
      // lieu d'arrêter la marche. `run:spike` et `accept`, eux, gardent l'arrêt strict du plan.
      if (!(error instanceof HarnessError)) throw error
      await budget.save(budgetPath)
      await writeHarnessFailure({ endpoint, message: error.message })
      decision = { verdict: 'non_mesurable', detail: error.message }
    }

    if (decision.verdict === 'retenu') {
      console.log(
        `${label} — RETENU en ${decision.latencySeconds.toFixed(1)} s (${result?.actualCostUsd ?? 0} USD).`,
      )
      console.log(
        `\nLance l'échelon complet :\n  npm run run:spike -- --model ${endpoint.model} --provider ${endpoint.providerSlug}`,
      )
      console.log(`Dépensé : ${budget.spent.toFixed(6)} USD.`)
      return
    }

    if (decision.verdict === 'trop_lent') {
      console.log(
        `${label} — trop lent : ${decision.latencySeconds.toFixed(1)} s > ${maximumLatencySeconds} s.`,
      )
    } else {
      console.log(
        `${label} — ${decision.verdict} : ${decision.detail.slice(0, 160)}`,
      )
      if (result && condemnsWholeModel(result)) {
        condemned.set(endpoint.model, decision.detail.slice(0, 160))
        console.log(
          `  → les autres endpoints de ${endpoint.model} sont écartés de cette marche.`,
        )
      }
    }
  }

  console.log(
    `\nAucun barreau retenu sur ${probed} sondé(s). Dépensé : ${budget.spent.toFixed(6)} USD.`,
  )
  process.exitCode = 1
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
