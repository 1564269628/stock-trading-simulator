import { createUser, submitOrder } from './tradingService.js'
import type { MemoryStore } from './store.js'

export function initializeBots(store: MemoryStore) {
  const bots = ['market-bot-1', 'market-bot-2', 'market-bot-3'].map(name => createUser(store, name, 'bot'))
  bots.forEach(bot => { bot.cash = 5_000_000; const positions = store.positions.get(bot.id)!; positions.set('600519', 1000); positions.set('000858', 3000); positions.set('300750', 2000) })
  return bots
}

export function runBotTick(store: MemoryStore, bots: ReturnType<typeof initializeBots>, random = Math.random) {
  const bot = bots[Math.floor(random() * bots.length)]
  const symbols = [...store.stocks.keys()]; const symbol = symbols[Math.floor(random() * symbols.length)]
  const side = random() < 0.5 ? 'BUY' : 'SELL' as const
  const quantity = [10, 20, 50][Math.floor(random() * 3)]
  const stock = store.stocks.get(symbol)!; const price = Number(Math.max(0.01, stock.latestPrice * (1 + (random() - 0.5) * 0.02)).toFixed(2))
  return submitOrder(store, { userId: bot.id, symbol, side, price, quantity })
}

export function startBotTrader(store: MemoryStore, onOrderResult: (result: ReturnType<typeof submitOrder>) => void, intervalMs = 3000) {
  const bots = initializeBots(store)
  const timer = setInterval(() => onOrderResult(runBotTick(store, bots)), intervalMs)
  return { bots, stop: () => clearInterval(timer) }
}
