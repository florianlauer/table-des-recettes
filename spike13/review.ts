#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LADDER, modelSlug } from './models.js'
import { DISHES, RENDERS_DIRECTORY } from './run.js'

export type ReviewCell = {
  model: string
  dish: string
  pass: number
  promptVersion: string
  imageSrc: string | null
  status: string
  detail: string | null
  costUsd: number
  latencyMs: number
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function renderReviewHtml(cells: ReviewCell[]): string {
  const byDish = DISHES.map((dish) => ({
    dish,
    cells: cells.filter((cell) => cell.dish === dish),
  }))

  const sections = byDish
    .map(
      ({ dish, cells: dishCells }) => `
    <section>
      <h2>${escapeHtml(dish)}</h2>
      <div class="row">
        <figure class="original">
          <img src="fixtures/dishes/${escapeHtml(dish)}.jpg" alt="originale ${escapeHtml(dish)}">
          <figcaption>Originale</figcaption>
        </figure>
        ${dishCells
          .map(
            (cell) => `
        <figure>
          ${
            cell.imageSrc
              ? `<img src="${escapeHtml(cell.imageSrc)}" alt="${escapeHtml(cell.model)} passe ${cell.pass}">`
              : `<div class="failed">${escapeHtml(cell.status)}${cell.detail ? ` — ${escapeHtml(cell.detail)}` : ''}</div>`
          }
          <figcaption>
            ${escapeHtml(cell.model)} · passe ${cell.pass} ·
            <strong>prompt ${escapeHtml(cell.promptVersion)}</strong><br>
            ${cell.costUsd.toFixed(5)} USD · ${Math.round(cell.latencyMs)} ms
          </figcaption>
        </figure>`,
          )
          .join('')}
      </div>
    </section>`,
    )
    .join('')

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Spike T13 — jugement des rendus</title>
<style>
  :root { --judge-height: 200px; }
  body { font-family: ui-serif, Georgia, serif; margin: 2rem; background: #F7F3EA; color: #2E2723; }
  .row { display: flex; gap: 1rem; overflow-x: auto; align-items: flex-start; padding-bottom: 1rem; }
  figure { margin: 0; flex: 0 0 auto; }
  img { height: var(--judge-height); width: auto; display: block; }
  body.full img { height: auto; max-width: 90vw; }
  /* Barrier 2 is judged against the original, and a row holds up to 8 renders. Without this the
     original scrolls out of view exactly when it is needed. */
  .original { position: sticky; left: 0; z-index: 1; background: #F7F3EA; padding-right: 0.75rem; }
  .original img { outline: 2px solid #9A5B2B; }
  .failed { height: var(--judge-height); width: 260px; display: flex; align-items: center;
            padding: 0.5rem; font-size: 0.8rem; background: #EFE7DA; overflow: auto; }
  figcaption { font-size: 0.75rem; margin-top: 0.35rem; max-width: 260px; }
  h2 { border-bottom: 1px solid #C6BDB4; padding-bottom: 0.25rem; }
  button { font: inherit; padding: 0.4rem 0.8rem; margin-bottom: 1.5rem; }
</style>
</head>
<body>
<h1>Spike T13 — jugement des rendus</h1>
<ol>
  <li>
    <strong>Barrière 1, éliminatoire — est-ce une vraie photographie ?</strong> Ni trame
    d'impression, ni grain de papier, ni perspective de page oblique, ni bord de feuille. Le
    redressement, le recadrage et le remplacement du fond sont autorisés.
  </li>
  <li>
    <strong>Barrière 2, éliminatoire mais tolérante — le plat reste-t-il reconnaissable ?</strong>
    Éliminatoire seulement si le plat n'est plus reconnaissable. Un ustensile ajouté, une garniture
    retouchée, un motif de pâte redessiné se notent comme écarts observés, sans disqualifier.
  </li>
  <li>
    <strong>Barrière 3, justification — le gain se voit-il ?</strong> À 200 px comme en pleine
    taille.
  </li>
</ol>
<button onclick="document.body.classList.toggle('full')">Pleine taille / 200 px</button>
${sections}
</body>
</html>
`
}

async function collectCells(): Promise<ReviewCell[]> {
  const cells: ReviewCell[] = []
  for (const rung of LADDER) {
    const directory = `${RENDERS_DIRECTORY}/${modelSlug(rung.model)}`
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      continue
    }
    for (const entry of entries
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      const sidecar = JSON.parse(
        await readFile(resolve(directory, entry), 'utf8'),
      ) as {
        dish: string
        pass: number
        promptVersion: string
        status: string
        reason: string | null
        detail: string | null
        mediaType: string | null
        latencyMs: number
        actualCostUsd: number
      }
      const extension =
        sidecar.mediaType === 'image/jpeg'
          ? 'jpg'
          : sidecar.mediaType === 'image/webp'
            ? 'webp'
            : 'png'
      cells.push({
        model: rung.model,
        dish: sidecar.dish,
        pass: sidecar.pass,
        promptVersion: sidecar.promptVersion,
        imageSrc:
          sidecar.status === 'image'
            ? `fixtures/renders/${modelSlug(rung.model)}/${sidecar.dish}-${sidecar.pass}-${sidecar.promptVersion}.${extension}`
            : null,
        status: sidecar.reason ?? sidecar.status,
        detail: sidecar.detail,
        costUsd: sidecar.actualCostUsd,
        latencyMs: sidecar.latencyMs,
      })
    }
  }
  return cells
}

async function main(): Promise<void> {
  const cells = await collectCells()
  await writeFile('spike13/review.html', renderReviewHtml(cells))
  console.log(
    `spike13/review.html écrit (${cells.length} cellules). Ouvre-le et juge les trois barrières.`,
  )
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
