+<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from './services/api'
import { connect } from './services/websocket'
import type { Order, Stock, Trade, UserState } from './types'
import PriceChart from './components/PriceChart.vue'
import OrderBookPanel from './components/OrderBookPanel.vue'
import './styles.css'

const username = ref(''); const password = ref(''); const user = ref<{ userId: string }>(); const state = ref<UserState>(); const message = ref('')
const selectedSymbol = ref('600519'); const buyPrice = ref(1500); const buyQuantity = ref(100); const sellPrice = ref(1500); const sellQuantity = ref(100)
const selectedStock = computed<Stock | undefined>(() => state.value?.stocks.find(stock => stock.symbol === selectedSymbol.value))
const currentOpenOrders = computed(() => state.value?.orders.filter(order => order.symbol === selectedSymbol.value && order.status !== 'FILLED') ?? [])
const currentFilledOrders = computed(() => state.value?.orders.filter(order => order.symbol === selectedSymbol.value && order.status === 'FILLED') ?? [])
const currentMyTrades = computed(() => state.value?.myTrades.filter(trade => trade.symbol === selectedSymbol.value) ?? [])
const currentMarketTrades = computed(() => state.value?.marketTrades.filter(trade => trade.symbol === selectedSymbol.value) ?? [])
const currentPosition = computed(() => state.value?.positions[selectedSymbol.value] ?? 0)
const reservedSellQuantity = computed(() => currentOpenOrders.value.filter(order => order.side === 'SELL').reduce((sum, order) => sum + order.remainingQuantity, 0))
const availableToSell = computed(() => Math.max(0, currentPosition.value - reservedSellQuantity.value))
const marketValue = computed(() => currentPosition.value * (selectedStock.value?.latestPrice ?? 0))
function selectStock(stock: Stock) { selectedSymbol.value = stock.symbol; buyPrice.value = stock.latestPrice; sellPrice.value = stock.latestPrice }
function tradeSide(trade: Trade): 'BUY' | 'SELL' { return trade.buyerId === user.value?.userId ? 'BUY' : 'SELL' }
function executionSummary(order: Order) { const related = currentMyTrades.value.filter(trade => order.side === 'BUY' ? trade.buyOrderId === order.id : trade.sellOrderId === order.id); const filledQuantity = related.reduce((sum, trade) => sum + trade.quantity, 0); const executionAmount = related.reduce((sum, trade) => sum + trade.price * trade.quantity, 0); return { filledQuantity, executionAmount, averageExecutionPrice: filledQuantity ? executionAmount / filledQuantity : 0 } }
async function refreshState() { if (user.value) state.value = await api(`/state?userId=${user.value.userId}`) }
async function auth(action: 'login' | 'register') { try { user.value = await api(`/auth/${action}`, { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) }); const loggedInUser = user.value!; await refreshState(); connect(loggedInUser.userId, async event => { if (event.type === 'market:update') { state.value!.stocks = event.data.stocks; for (const [symbol, point] of Object.entries(event.data.points)) state.value!.priceHistory[symbol] = [...(state.value!.priceHistory[symbol] ?? []), point as any].slice(-90) } if (event.type === 'orderbook:update') state.value!.orderBooks[event.data.symbol] = event.data; if (event.type === 'user:update' || event.type === 'trade:new') await refreshState() }) } catch (error) { message.value = (error as Error).message } }
async function submit(side: 'BUY' | 'SELL') { try { await api('/orders', { method: 'POST', body: JSON.stringify({ userId: user.value?.userId, symbol: selectedSymbol.value, side, price: Number(side === 'BUY' ? buyPrice.value : sellPrice.value), quantity: Number(side === 'BUY' ? buyQuantity.value : sellQuantity.value) }) }); await refreshState(); message.value = '' } catch (error) { message.value = (error as Error).message } }
</script>
<template>
<main class="terminal">
<section v-if="!user" class="auth panel"><h1>Stock Trading Simulator</h1><input v-model="username" placeholder="用户名"><input v-model="password" type="password" placeholder="密码"><button @click="auth('login')">登录</button><button @click="auth('register')">注册</button><p class="error">{{ message }}</p></section>
<template v-else>
<header class="topbar"><div><span class="muted">当前股票</span><h1>{{ selectedStock?.name }} <small>{{ selectedStock?.symbol }}</small></h1></div><div>资金 <strong>{{ state?.user.cash.toFixed(2) }}</strong></div></header>
<section class="layout"><aside class="panel stock-list"><h3>股票选择</h3><button v-for="stock in state?.stocks" :key="stock.symbol" :class="{ active: stock.symbol === selectedSymbol }" @click="selectStock(stock)"><div class="stock-name">{{ stock.name }}</div><div>{{ stock.symbol }} · {{ stock.latestPrice.toFixed(2) }}</div><div :class="stock.changePercent >= 0 ? 'up' : 'down'">{{ stock.changePercent.toFixed(2) }}%</div></button></aside>
<section class="panel"><div class="muted">最新价 / 涨跌幅</div><div class="price">{{ selectedStock?.latestPrice.toFixed(2) }} <span :class="(selectedStock?.changePercent ?? 0) >= 0 ? 'up' : 'down'">{{ selectedStock?.changePercent.toFixed(2) }}%</span></div><PriceChart :points="state?.priceHistory[selectedSymbol] ?? []" /><div class="forms">
<form class="trade-form buy" @submit.prevent="submit('BUY')"><h3>BUY 买入</h3><label>当前股票<input :value="`${selectedStock?.name ?? ''} ${selectedSymbol}`" readonly></label><label>买入价格<input v-model="buyPrice" type="number" min="0" step="0.01"></label><label>买入数量<input v-model="buyQuantity" type="number" min="1"></label><button>提交买入</button></form>
<form class="trade-form sell" @submit.prevent="submit('SELL')"><h3>SELL 卖出</h3><label>当前股票<input :value="`${selectedStock?.name ?? ''} ${selectedSymbol}`" readonly></label><label>卖出价格<input v-model="sellPrice" type="number" min="0" step="0.01"></label><label>卖出数量<input v-model="sellQuantity" type="number" min="1"></label><p>当前持仓：{{ currentPosition }}</p><p>可卖数量：{{ availableToSell }}</p><button>提交卖出</button></form></div><p class="error">{{ message }}</p></section>
<aside class="panel"><OrderBookPanel :snapshot="state?.orderBooks[selectedSymbol]" :latest-price="selectedStock?.latestPrice" /></aside></section>
<section class="bottom">
<section class="panel"><h3>当前委托 · {{ selectedSymbol }}</h3><p v-if="!currentOpenOrders.length" class="muted">暂无当前委托</p><table v-else><tr><th>方向</th><th>委托价</th><th>委托量</th><th>已成交</th><th>剩余</th><th>状态</th><th>时间</th></tr><tr v-for="order in currentOpenOrders" :key="order.id"><td>{{ order.side }}</td><td>{{ order.price }}</td><td>{{ order.quantity }}</td><td>{{ order.quantity - order.remainingQuantity }}</td><td>{{ order.remainingQuantity }}</td><td>{{ order.status }}</td><td>{{ order.createdAt }}</td></tr></table></section>
<section class="panel"><h3>已成交订单 · {{ selectedSymbol }}</h3><p v-if="!currentFilledOrders.length" class="muted">暂无已成交订单</p><table v-else><tr><th>方向</th><th>委托价</th><th>委托量</th><th>成交量</th><th>均价</th><th>金额</th><th>状态</th><th>时间</th></tr><tr v-for="order in currentFilledOrders" :key="order.id"><td>{{ order.side }}</td><td>{{ order.price }}</td><td>{{ order.quantity }}</td><td>{{ executionSummary(order).filledQuantity }}</td><td>{{ executionSummary(order).averageExecutionPrice.toFixed(2) }}</td><td>{{ executionSummary(order).executionAmount.toFixed(2) }}</td><td>{{ order.status }}</td><td>{{ order.createdAt }}</td></tr></table></section>
<section class="panel"><h3>当前持仓 · {{ selectedSymbol }}</h3><p v-if="!currentPosition" class="muted">暂无持仓</p><template v-else><p>{{ selectedStock?.name }}（{{ selectedSymbol }}）</p><p>数量：{{ currentPosition }}</p><p>当前价：{{ selectedStock?.latestPrice.toFixed(2) }}</p><p>当前市值：{{ marketValue.toFixed(2) }}</p></template></section>
<section class="panel"><h3>我的成交 · {{ selectedSymbol }}</h3><p v-if="!currentMyTrades.length" class="muted">暂无成交</p><table v-else><tr><th>方向</th><th>价格</th><th>数量</th><th>金额</th><th>时间</th></tr><tr v-for="trade in currentMyTrades" :key="trade.tradeId"><td>{{ tradeSide(trade) }}</td><td>{{ trade.price }}</td><td>{{ trade.quantity }}</td><td>{{ (trade.price * trade.quantity).toFixed(2) }}</td><td>{{ trade.createdAt }}</td></tr></table></section>
<section class="panel"><h3>市场成交 · {{ selectedSymbol }}</h3><p v-if="!currentMarketTrades.length" class="muted">暂无成交</p><table v-else><tr><th>价格</th><th>数量</th><th>时间</th></tr><tr v-for="trade in currentMarketTrades" :key="trade.tradeId"><td>{{ trade.price }}</td><td>{{ trade.quantity }}</td><td>{{ trade.createdAt }}</td></tr></table></section>
</section></template></main>
</template>
