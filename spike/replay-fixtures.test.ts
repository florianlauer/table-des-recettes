// @vitest-environment node
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { replayFixtures } from './replay-fixtures.js'

test('replays the archived corpus and keeps scaling coverage above its measured floor', async () => {
  const result = await replayFixtures({
    directory: resolve('spike/fixtures/runs'),
  })
  expect(result.successRuns).toBe(101)
  expect(result.ingredientLines).toBe(1865)
  expect(result.annotatedLines).toBe(1588)
  expect(result.scalableLines).toBe(1484)
  expect(result.scalingRate).toBeGreaterThanOrEqual(0.93)
})
