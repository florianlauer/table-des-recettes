import { readFileSync, existsSync } from 'node:fs'

const ROOT =
  '/Users/florianlauer/Documents/perso/table-des-recettes/.claude/worktrees/spike-t1-extraction'
const PAGES = ['a', 'b', 'c', 'e', 'f', 'g', 'h']
const MODELS = [
  ['google/gemini-3-flash-preview', 'google-ai-studio'],
  ['google/gemini-2.5-flash-lite', 'google-ai-studio'],
  ['openai/gpt-5.6-luna', 'openai'],
  ['mistralai/ministral-8b-2512', 'mistral'],
  ['qwen/qwen3.5-9b', 'siliconflow'],
  ['qwen/qwen3.5-35b-a3b', 'deepinfra'],
  ['qwen/qwen3-vl-32b-instruct', 'alibaba'],
  ['qwen/qwen3.6-flash', 'alibaba'],
]

const load = (m, p, page, pass) => {
  const path = `${ROOT}/spike/fixtures/runs/${m}/${p}/${page}-${pass}.json`
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

const flat = (e) =>
  e.recipes.flatMap((r, i) => [
    `r${i}.titre ${r.title}`,
    `r${i}.portions ${r.servings}`,
    ...r.ingredients.map((g, j) => `r${i}.i${j} ${g.raw}`),
    ...r.steps.map((s, j) => `r${i}.e${j} ${s}`),
  ])

for (const [model, provider] of MODELS) {
  console.log(`\n=== ${model}`)
  for (const page of PAGES) {
    const one = load(model, provider, page, 1)
    const two = load(model, provider, page, 2)
    if (!one || one.status !== 'success' || two?.status !== 'success') continue
    const A = flat(one.parsed)
    const B = flat(two.parsed)
    const diffs = []
    for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
      if (A[i] !== B[i]) diffs.push([A[i], B[i]])
    }
    if (!diffs.length) continue
    // Same count on both sides means the divergence is textual, not structural: an item appeared or
    // vanished would shift every later index and blow the list up.
    const kind = A.length === B.length ? 'texte' : 'STRUCTURE'
    console.log(`  ${page.toUpperCase()} ${kind} — ${diffs.length} ligne(s)`)
    for (const [x, y] of diffs.slice(0, 4)) {
      console.log(`      1| ${String(x).slice(0, 95)}`)
      console.log(`      2| ${String(y).slice(0, 95)}`)
    }
  }
}
