import { cancelOrder, createUser, submitOrder } from './tradingService.js'
import type { MemoryStore } from './store.js'

export const BOT_TICK_MS = 1000
export const BOT_ORDER_TTL_MS = 9000
export const BOT_PRICE_RANGE = 0.005
const quantities = [10, 20, 50, 100]

export function initializeBots(store: MemoryStore) {
  const bots = ['market-bot-1', 'market-bot-2', 'market-bot-3'].map(name => createUser(store, name, 'bot'))
  bots.forEach(bot => { bot.cash = 100_000_000; const positions = store.positions.get(bot.id)!; positions.set('600519', 100_000); positions.set('000858', 300_000); positions.set('300750', 200_000) })
  return bots
}

const randomCount = (random: () => number) => 2 + Math.floor(random() * 3)
const randomQuantity = (random: () => number) => quantities[Math.floor(random() * quantities.length)]
const randomPrice = (referencePrice: number, random: () => number) => Number(Math.max(0.01, referencePrice * (1 + (random() * 2 - 1) * BOT_PRICE_RANGE)).toFixed(2))

export function expireBotOrders(store: MemoryStore, bots: ReturnType<typeof initializeBots>, now = Date.now()) {
  const botIds = new Set(bots.map(bot => bot.id)); const expired = []
  for (const order of store.orders.values()) {
    if (botIds.has(order.userId) && (order.status === 'PENDING' || order.status === 'PARTIALLY_FILLED') && now - Date.parse(order.createdAt) >= BOT_ORDER_TTL_MS) expired.push(cancelOrder(store, order.userId, order.id))
  }
  return expired
}

export function runBotTick(store: MemoryStore, bots: ReturnType<typeof initializeBots>, random = Math.random) {
  expireBotOrders(store, bots)
  const results: ReturnType<typeof submitOrder>[] = []
  for (const symbol of store.stocks.keys()) {
    const stock = store.stocks.get(symbol)!; const buyCount = randomCount(random); const sellCount = randomCount(random)
    for (let index = 0; index < buyCount; index++) {
      try { results.push(submitOrder(store, { userId: bots[index % bots.length].id, symbol, side: 'BUY', price: randomPrice(stock.referencePrice, random), quantity: randomQuantity(random) })) } catch (error) { if ((error as Error).message !== 'insufficient cash') throw error }
    }
    for (let index = 0; index < sellCount; index++) {
      try { results.push(submitOrder(store, { userId: bots[(index + 1) % bots.length].id, symbol, side: 'SELL', price: randomPrice(stock.referencePrice, random), quantity: randomQuantity(random) })) } catch (error) { if ((error as Error).message !== 'insufficient cash' && (error as Error).message !== 'insufficient position') throw error }
    }
  }
  return results
}

export function startBotTrader(store: MemoryStore, onOrderResult: (result: ReturnType<typeof submitOrder>) => void, intervalMs = BOT_TICK_MS) {
  const bots = initializeBots(store)
  runBotTick(store, bots).forEach(onOrderResult)
  const timer = setInterval(() => runBotTick(store, bots).forEach(onOrderResult), intervalMs)
  return { bots, stop: () => clearInterval(timer) }
}
