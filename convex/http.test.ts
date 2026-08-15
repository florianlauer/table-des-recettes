// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { createBackupResponse } from './http'
import { completeBackupRecipe } from '../src/shared/backup-schema.fixture'

function request(token?: string): Request {
  return new Request('https://example.convex.site/backup', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

describe('backup endpoint authentication', () => {
  test.each([
    ['no authorization header', request(), 'expected-token'],
    ['a wrong token', request('wrong-token'), 'expected-token'],
    ['a wrong-length token', request('x'), 'expected-token'],
    ['no server token', request('expected-token'), undefined],
  ])('returns 401 for %s', async (_case, incomingRequest, expectedToken) => {
    const loadRecipes = vi.fn(async () => [completeBackupRecipe])
    const response = await createBackupResponse({
      request: incomingRequest,
      expectedToken,
      loadRecipes,
    })
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('')
    expect(loadRecipes).not.toHaveBeenCalled()
  })

  test('returns the backup payload for the configured token', async () => {
    const response = await createBackupResponse({
      request: request('expected-token'),
      expectedToken: 'expected-token',
      loadRecipes: async () => [completeBackupRecipe],
      now: () => new Date('2026-08-11T03:00:00.000Z'),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual({
      formatVersion: '1',
      generatedAt: '2026-08-11T03:00:00.000Z',
      recipes: [completeBackupRecipe],
    })
  })
})
