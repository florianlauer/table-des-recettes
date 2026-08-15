import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const REPO = normalize(join(dirname(fileURLToPath(import.meta.url)), '../..'))

/** What the browser is not asked to carry. Prose, in French, for a model it never calls. */
const SERVER_ONLY = [
  'src/shared/beautifyPrompt.ts',
  'src/shared/recipe-prompt.ts',
]

function read(path: string): string | null {
  try {
    return readFileSync(join(REPO, path), 'utf8')
  } catch {
    return null
  }
}

/** Resolution as the bundler does it, minus the parts this repository never uses. */
function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const raw = normalize(join(dirname(from), specifier))
  const stem = raw.endsWith('.js') ? raw.slice(0, -3) : raw
  for (const extension of ['.ts', '.tsx'])
    if (read(stem + extension) !== null) return stem + extension
  return null
}

function reachable(entries: string[]): Set<string> {
  const seen = new Set(entries)
  const stack = [...entries]
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    const source = read(file) ?? ''
    for (const [, specifier] of source.matchAll(/from '([^']+)'/g)) {
      const target = resolve(file, specifier ?? '')
      if (target === null || seen.has(target)) continue
      seen.add(target)
      stack.push(target)
    }
  }
  return seen
}

/**
 * The kernel's contract has one clause ESLint cannot express, because it is about a *path* through
 * the graph rather than about one import: a module the browser never asks for can still be pulled in
 * by one it does. That is what the generation journal did — displayed in the admin, it read its cost
 * threshold from `beautifyPrompt`, so the prompt was in the browser's import graph. That is why
 * `beautifyCost` exists.
 *
 * The claim here is about the graph, not about the shipped bytes: Rollup tree-shakes the prompt out
 * of the built bundle either way, verified on the build. Which is the point — the rule the comment
 * in `illustrationWork` states is « the screen reads this without dragging a server module in », and
 * a rule that only holds because the bundler can prove the string unused is not held by us at all.
 */
test('no prompt is reachable from the browser, by any path', () => {
  const entries = readdirSync(join(REPO, 'src/routes'))
    .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
    .map((name) => `src/routes/${name}`)
    .concat('src/router.tsx')
  const bundle = reachable(entries)

  // Without this the assertion below passes by walking nothing at all.
  expect(bundle.size).toBeGreaterThan(20)
  for (const module of SERVER_ONLY) {
    expect(read(module), `${module} exists`).not.toBeNull()
    expect([...bundle], `${module} stays out of the bundle`).not.toContain(
      module,
    )
  }
})
