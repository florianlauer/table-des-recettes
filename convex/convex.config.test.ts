import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

/**
 * `app.use(x)` and `app.use(x, { name })`, as (component, name) pairs. A component mounted under a
 * name is a distinct instance, so the name is part of the identity, not a label.
 */
function mounted(): Array<[string, string | null]> {
  return [
    ...read('./convex.config.ts').matchAll(
      /app\.use\((\w+)(?:,\s*\{\s*name:\s*'([^']+)'\s*\})?\)/g,
    ),
  ].map(named)
}

/** The mirror image, in the test harness: `xTest.register(t)` / `xTest.register(t, 'name')`. */
function registered(): Array<[string, string | null]> {
  return [
    ...read('../test/convexComponents.ts').matchAll(
      /(\w+)Test\.register\(t(?:,\s*'([^']+)')?\)/g,
    ),
  ].map(named)
}

/**
 * `.at()` rather than a destructure: a second capture group that did not participate is `undefined` at
 * runtime, and `RegExpMatchArray` types its entries as plain `string` — a lie that would make the
 * unnamed mounts compare as the string "undefined".
 */
function named(match: RegExpMatchArray): [string, string | null] {
  return [match.at(1) ?? '', match.at(2) ?? null]
}

/**
 * Both halves order the comparison, joined by a byte neither can contain. Left implicit, `.sort()`
 * would order the pairs by `String(pair)` — the two halves joined by a comma, which a name may hold.
 */
function byIdentity(
  a: [string, string | null],
  b: [string, string | null],
): number {
  const key = (pair: [string, string | null]) => pair.join('\u0000')
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0
}

/**
 * The drift this catches, and the reason it is a source scan rather than a call to `defineApp`: a
 * component added to the app and forgotten in the harness does not fail here, it fails as
 * `Component "x" is not registered` in whichever of the eleven Convex test files happens to touch the
 * code path first — a message that names the symptom and not the omission.
 *
 * A previous version of this file mocked all four component configs and asserted `app` was defined.
 * `defineApp()` always returns an object, so it could not fail; its only real effect was one more mock
 * to write every time a component was mounted.
 */
test('every mounted component is registered in the test harness, under the same name', () => {
  expect(registered().sort(byIdentity)).toEqual(mounted().sort(byIdentity))
  // The regexes are the load-bearing part: zero matches on either side would make the line above pass.
  expect(mounted().length).toBeGreaterThanOrEqual(4)
})
