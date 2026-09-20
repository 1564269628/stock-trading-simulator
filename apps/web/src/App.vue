+<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from './services/api'
import { connect } from './services/websocket'
import type { Stock, UserState } from './types'
import PriceChart from './components/PriceChart.vue'
import OrderBookPanel from './components/OrderBookPanel.vue'
import './styles.css'

const username = ref(''); const password = ref(''); const user = ref<{ userId: string }>(); const state = ref<UserState>(); const message = ref('')
const selectedSymbol = ref('600519'); const buyPrice = ref(1500); const buyQuantity = ref(100); const sellPrice = ref(1500); const sellQuantity = ref(100)
const selectedStock = computed<Stock | undefined>(() => state.value?.stocks.find(stock => stock.symbol === selectedSymbol.value))
const openOrders = computed(() => state.value?.orders.filter(order => order.status !== 'FILLED') ?? [])
const filledOrders = computed(() => state.value?.orders.filter(order => order.status === 'FILLED') ?? [])
const currentPosition = computed(() => state.value?.positions[selectedSymbol.value] ?? 0)
function selectStock(stock: Stock) { selectedSymbol.value = stock.symbol; buyPrice.value = stock.latestPrice; sellPrice.value = stock.latestPrice }
async function refreshState() { if (user.value) state.value = await api(`/state?userId=${user.value.userId}`) }
async function auth(action: 'login' | 'register') { try { user.value = await api(`/auth/${action}`, { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) }); const loggedInUser = user.value!; await refreshState(); connect(loggedInUser.userId, async event => { if (event.type === 'market:update') { state.value!.stocks = event.data.stocks; for (const [symbol, point] of Object.entries(event.data.points)) state.value!.priceHistory[symbol] = [...(state.value!.priceHistory[symbol] ?? []), point as any].slice(-90) } if (event.type === 'orderbook:update') state.value!.orderBooks[event.data.symbol] = event.data; if (event.type === 'user:update' || event.type === 'trade:new') await refreshState() }) } catch (error) { message.value = (error as Error).message } }
async function submit(side: 'BUY' | 'SELL') { try { await api('/orders', { method: 'POST', body: JSON.stringify({ userId: user.value?.userId, symbol: selectedSymbol.value, side, price: Number(side === 'BUY' ? buyPrice.value : sellPrice.value), quantity: Number(side === 'BUY' ? buyQuantity.value : sellQuantity.value) }) }); await refreshState(); message.value = '' } catch (error) { message.value = (error as Error).message } }
</script>
<template>
  <main class="terminal">
    <section v-if="!user" class="auth panel"><h1>Stock Trading Simulator</h1><input v-model="username" placeholder="用户名"><input v-model="password" type="password" placeholder="密码"><button @click="auth('login')">登录</button><button @click="auth('register')">注册</button><p class="error">{{ message }}</p></section>
    <template v-else>
      <header class="topbar"><div><span class="muted">当前股票</span><h1>{{ selectedStock?.name }} <small>{{ selectedStock?.symbol }}</small></h1></div><div>资金 <strong>{{ state?.user.cash.toFixed(2) }}</strong></div></header>
      <section class="layout"><aside class="panel stock-list"><h3>自选股票</h3><button v-for="stock in state?.stocks" :key="stock.symbol" :class="{ active: stock.symbol === selectedSymbol }" @click="selectStock(stock)"><div class="stock-name">{{ stock.name }}</div><div>{{ stock.symbol }} · {{ stock.latestPrice.toFixed(2) }}</div><div :class="stock.changePercent >= 0 ? 'up' : 'down'">{{ stock.changePercent.toFixed(2) }}%</div></button></aside>
        <section class="panel"><div class="muted">最新价 / 涨跌幅</div><div class="price">{{ selectedStock?.latestPrice.toFixed(2) }} <span :class="(selectedStock?.changePercent ?? 0) >= 0 ? 'up' : 'down'">{{ selectedStock?.changePercent.toFixed(2) }}%</span></div><PriceChart :points="state?.priceHistory[selectedSymbol] ?? []" /><div class="forms"><form class="trade-form buy" @submit.prevent="submit('BUY')"><h3>BUY 买入</h3><input v-model="buyPrice" type="number" min="0" step="0.01"><input v-model="buyQuantity" type="number" min="1"><button>提交买入</button></form><form class="trade-form sell" @submit.prevent="submit('SELL')"><h3>SELL 卖出</h3><p class="muted">持仓：{{ currentPosition }} · 可卖以服务端校验为准</p><input v-model="sellPrice" type="number" min="0" step="0.01"><input v-model="sellQuantity" type="number" min="1"><button>提交卖出</button></form></div><p class="error">{{ message }}</p></section>
        <aside class="panel"><OrderBookPanel :snapshot="state?.orderBooks[selectedSymbol]" /></aside>
      </section>
      <section class="bottom"><section class="panel"><h3>当前委托</h3><table><tr><th>方向</th><th>价格</th><th>剩余</th></tr><tr v-for="order in openOrders" :key="order.id"><td>{{ order.side }}</td><td>{{ order.price }}</td><td>{{ order.remainingQuantity }}/{{ order.quantity }}</td></tr></table></section><section class="panel"><h3>已成交订单</h3><table><tr><th>方向</th><th>股票</th><th>数量</th></tr><tr v-for="order in filledOrders" :key="order.id"><td>{{ order.side }}</td><td>{{ order.symbol }}</td><td>{{ order.quantity }}</td></tr></table></section><section class="panel"><h3>持仓 / 最近成交</h3><div v-for="(value, key) in state?.positions" :key="key">{{ key }}：{{ value }}</div><p v-for="trade in state?.recentTrades" :key="trade.tradeId" class="muted">{{ trade.symbol }} {{ trade.price }} × {{ trade.quantity }}</p></section></section>
    </template>
  </main>
</template>
