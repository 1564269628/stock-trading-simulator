import { describe, expect, it } from 'vitest'
import { MemoryStore } from './store.js'
import { initializeBots, runBotTick } from './botTrader.js'

describe('bot trader', () => {
  it('creates normal users and submits through the trading service', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); const result = runBotTick(store, bots, () => 0.1)
    expect(bots).toHaveLength(3); expect(bots[0].cash).toBe(5_000_000); expect(store.positions.get(bots[0].id)?.get('600519')).toBe(1000); expect(store.orders.has(result.order.id)).toBe(true)
  })
  it('does not allow bot sells to exceed holdings', () => {
    const store = new MemoryStore(); const bots = initializeBots(store); expect(() => runBotTick(store, bots, () => 0.9)).not.toThrow(); expect([...store.positions.values()].every(positions => [...positions.values()].every(quantity => quantity >= 0))).toBe(true)
  })
})
