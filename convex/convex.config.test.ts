import { expect, test, vi } from 'vitest'

vi.mock('@convex-dev/rate-limiter/convex.config', () => ({
  default: {
    componentDefinitionPath: 'rateLimiter',
    defaultName: 'rateLimiter',
  },
}))

test('mounts the application component configuration', async () => {
  const { default: app } = await import('./convex.config')
  expect(app).toBeDefined()
})
