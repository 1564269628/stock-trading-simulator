export type OrderSide = 'BUY' | 'SELL'
export type OrderStatus = 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED'

export interface User { id: string; username: string; password: string; cash: number; createdAt: string }
export interface Stock { symbol: string; name: string; initialPrice: number; referencePrice: number; latestPrice: number; changePercent: number }
export interface Order { id: string; userId: string; symbol: string; side: OrderSide; price: number; quantity: number; remainingQuantity: number; status: OrderStatus; sequence: number; createdAt: string }
export interface Trade { tradeId: string; symbol: string; price: number; quantity: number; buyOrderId: string; sellOrderId: string; buyerId: string; sellerId: string; createdAt: string }
export interface OrderBook { buys: Order[]; sells: Order[] }
export interface PricePoint { timestamp: string; price: number }
