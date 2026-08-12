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

function convexQueryCalls(source: string): Array<string> {
  const calls: Array<string> = []
  const marker = 'convexQuery('
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
