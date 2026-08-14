import { expect, test, vi } from 'vitest'

vi.mock('@convex-dev/rate-limiter/convex.config', () => ({
  default: {
    componentDefinitionPath: 'rateLimiter',
    defaultName: 'rateLimiter',
  },
}))

vi.mock('@convex-dev/migrations/convex.config', () => ({
  default: {
    componentDefinitionPath: 'migrations',
    defaultName: 'migrations',
  },
}))

test('mounts the application component configuration', async () => {
  const { default: app } = await import('./convex.config')
  expect(app).toBeDefined()
})
