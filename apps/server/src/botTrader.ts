import { createUser, submitOrder } from './tradingService.js'
import type { MemoryStore } from './store.js'
import type { Stock } from './types.js'

export const BOT_MATCH_BAND_RATE = 0.02
export const BOT_QUOTE_OFFSET_RATE = 0.001
export const BOT_TICK_MS = 1000

export function initializeBots(store: MemoryStore) {
  const bots = ['market-bot-1', 'market-bot-2', 'market-bot-3'].map(name => createUser(store, name, 'bot'))
  bots.forEach(bot => { bot.cash = 100_000_000; const positions = store.positions.get(bot.id)!; positions.set('600519', 100_000); positions.set('000858', 300_000); positions.set('300750', 200_000) })
  return bots
}

const quote = (stock: Stock, rate: number) => Number(Math.max(0.01, stock.referencePrice * (1 + rate)).toFixed(2))
const eligible = (stock: Stock, price: number) => Math.abs(price - stock.referencePrice) / stock.referencePrice <= BOT_MATCH_BAND_RATE

export function runLiquidityCycle(store: MemoryStore, bots: ReturnType<typeof initializeBots>, symbol: string, random = Math.random) {
  const stock = store.stocks.get(symbol)!; const quantity = 10; const results: ReturnType<typeof submitOrder>[] = []
  const policy = { matchOptions: { canMatch: (resting: { price: number }) => eligible(stock, resting.price) } }
  if (random() < 0.5) {
    results.push(submitOrder(store, { userId: bots[0].id, symbol, side: 'SELL', price: quote(stock, BOT_QUOTE_OFFSET_RATE), quantity }, policy))
    results.push(submitOrder(store, { userId: bots[1].id, symbol, side: 'BUY', price: quote(stock, BOT_QUOTE_OFFSET_RATE), quantity }, policy))
  } else {
    results.push(submitOrder(store, { userId: bots[0].id, symbol, side: 'BUY', price: quote(stock, -BOT_QUOTE_OFFSET_RATE), quantity }, policy))
    results.push(submitOrder(store, { userId: bots[1].id, symbol, side: 'SELL', price: quote(stock, -BOT_QUOTE_OFFSET_RATE), quantity }, policy))
  }
  return results
}

export function runBotTick(store: MemoryStore, bots: ReturnType<typeof initializeBots>, random = Math.random) {
  return [...store.stocks.keys()].flatMap(symbol => runLiquidityCycle(store, bots, symbol, random))
}

export function startBotTrader(store: MemoryStore, onOrderResult: (result: ReturnType<typeof submitOrder>) => void, intervalMs = BOT_TICK_MS) {
  const bots = initializeBots(store)
  const timer = setInterval(() => runBotTick(store, bots).forEach(onOrderResult), intervalMs)
  return { bots, stop: () => clearInterval(timer) }
}
