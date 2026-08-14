import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const ADMIN_ROUTES = [
  'admin.tsx',
  'admin_.illustrations.tsx',
  'admin_.scan.$id.tsx',
]

function read(route: string): string {
  return readFileSync(fileURLToPath(new URL(route, import.meta.url)), 'utf8')
}

function callsOf(source: string, marker: string): Array<string> {
  const calls: Array<string> = []
  let cursor = source.indexOf(marker)
  while (cursor !== -1) {
    let depth = 0
    let index = cursor + marker.length - 1
    do {
      if (source[index] === '(') depth += 1
      if (source[index] === ')') depth -= 1
      index += 1
    } while (depth > 0 && index < source.length)
    calls.push(source.slice(cursor, index))
    cursor = source.indexOf(marker, index)
  }
  return calls
}

const convexQueryCalls = (source: string) => callsOf(source, 'convexQuery(')

// `enabled: false` does not stop @convex-dev/react-query from subscribing: it
// watches the cache "added" event and only honours literal "skip" args. Gating
// with `enabled` sent an empty token to the server, which answered with an
// opaque "Server Error" in production.
test('admin routes gate token-bound queries with "skip", never with enabled', () => {
  for (const route of ADMIN_ROUTES) {
    const source = read(route)
    expect(source, route).not.toMatch(/enabled: adminToken/)
    const gated = convexQueryCalls(source).filter((call) =>
      call.includes('adminToken'),
    )
    expect(gated.length, route).toBeGreaterThan(0)
    for (const call of gated) expect(call, route).toContain("'skip'")
  }
})

/**
 * A query argument that is also local state changes the query key while the screen is open, and
 * react-query answers a key it has never seen with `undefined`. On the photo screen that blanked
 * everything below the header for one render: the page collapsed to a single line, the browser landed
 * back at the top, and every native `<details>` returned as a new node — which is to say closed, since
 * a fold keeps its open state in the DOM. Unfolding a section took two clicks and looked broken.
 */
test('a query whose args carry local state keeps the previous answer', () => {
  let stateful = 0
  for (const route of ADMIN_ROUTES) {
    const source = read(route)
    // Read off the file rather than listed here: the rule has to hold for state a later screen
    // introduces, under whatever name it picks.
    const names = [
      ...source.matchAll(/const \[(\w+), set\w+\] = useState/g),
    ].map((match) => match.at(1) ?? '')
    for (const call of callsOf(source, 'useQuery(')) {
      const carried = names.filter((name) =>
        new RegExp(`\\b${name}\\b`).test(call),
      )
      if (carried.length === 0) continue
      stateful += 1
      expect(call, `${route} carries ${carried.join(', ')}`).toContain(
        'placeholderData: keepPreviousData',
      )
    }
  }
  // Without this the loop above passes by finding nothing at all.
  expect(stateful).toBeGreaterThan(0)
})
