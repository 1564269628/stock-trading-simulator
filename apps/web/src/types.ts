export interface Stock { symbol: string; name: string; initialPrice: number; latestPrice: number; changePercent: number }
export interface Order { id: string; userId: string; symbol: string; side: 'BUY' | 'SELL'; price: number; quantity: number; remainingQuantity: number; status: 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED'; createdAt: string }
export interface Trade { tradeId: string; symbol: string; price: number; quantity: number; buyerId: string; sellerId: string; createdAt: string }
export interface PricePoint { timestamp: string; price: number }
export interface OrderBookLevel { price: number; quantity: number; orderCount: number }
export interface OrderBookSnapshot { symbol: string; asks: OrderBookLevel[]; bids: OrderBookLevel[] }
export interface UserState { user: { id: string; username: string; cash: number }; stocks: Stock[]; orders: Order[]; positions: Record<string, number>; recentTrades: Trade[]; priceHistory: Record<string, PricePoint[]>; orderBooks: Record<string, OrderBookSnapshot> }
