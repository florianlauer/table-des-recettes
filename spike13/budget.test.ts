import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BUDGET_CAP_USD, BudgetCounter, BudgetExceededError } from './budget.js'

describe('BudgetCounter', () => {
  it('allows a call that fits under the cap', () => {
    const counter = new BudgetCounter({ spent: 1, cap: 10 })
    expect(() => counter.assertCanSpend(8)).not.toThrow()
  })

  it('refuses a call whose worst case would cross the cap', () => {
    const counter = new BudgetCounter({ spent: 9.5, cap: 10 })
    expect(() => counter.assertCanSpend(1)).toThrow(BudgetExceededError)
  })

  it('refuses a call landing exactly on the cap boundary plus one cent', () => {
    const counter = new BudgetCounter({ spent: 10, cap: 10 })
    expect(() => counter.assertCanSpend(0.01)).toThrow(BudgetExceededError)
  })

  it('accumulates recorded costs', () => {
    const counter = new BudgetCounter({ cap: 10 })
    counter.record(0.25)
    counter.record(0.5)
    expect(counter.spent).toBeCloseTo(0.75, 10)
  })

  it('rejects a non-finite or negative cost rather than silently skewing the total', () => {
    const counter = new BudgetCounter({ cap: 10 })
    expect(() => counter.record(Number.NaN)).toThrow()
    expect(() => counter.record(-1)).toThrow()
  })

  it('starts from zero when no counter file exists yet', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't13-budget-'))
    const counter = await BudgetCounter.load({
      path: join(directory, 'absent.json'),
      cap: 10,
    })
    expect(counter.spent).toBe(0)
  })

  it('round-trips through disk so a rerun cannot forget past spending', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't13-budget-'))
    const path = join(directory, 'budget.json')
    const counter = new BudgetCounter({ cap: 10 })
    counter.record(1.5)
    await counter.save(path)

    const reloaded = await BudgetCounter.load({ path, cap: 10 })
    expect(reloaded.spent).toBeCloseTo(1.5, 10)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      currency: 'USD',
      spentUsd: 1.5,
    })
  })

  it('refuses to start rather than treating a corrupted counter as zero', async () => {
    const directory = await mkdtemp(join(tmpdir(), 't13-budget-'))
    const path = join(directory, 'budget.json')
    await writeFile(path, '{ not json')
    await expect(BudgetCounter.load({ path, cap: 10 })).rejects.toThrow()
  })

  it('caps the bench at ten dollars by default', () => {
    expect(BUDGET_CAP_USD).toBe(10)
  })
})
