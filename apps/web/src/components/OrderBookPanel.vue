+<script setup lang="ts">
import type { OrderBookSnapshot } from '../types'
defineProps<{ snapshot?: OrderBookSnapshot; latestPrice?: number }>()
</script>
<template><section><h3>盘口</h3><table><tr><th>档位</th><th>价格</th><th>数量</th></tr><template v-for="(level, index) in [...(snapshot?.asks ?? [])].reverse()" :key="`a-${level.price}`"><tr class="down"><td>卖{{ index + 1 }}</td><td>{{ level.price }}</td><td>{{ level.quantity }}</td></tr></template><tr class="current-price"><td colspan="3">当前价 {{ latestPrice?.toFixed(2) ?? '-' }}</td></tr><tr v-for="(level, index) in snapshot?.bids" :key="`b-${level.price}`" class="up"><td>买{{ index + 1 }}</td><td>{{ level.price }}</td><td>{{ level.quantity }}</td></tr></table><p v-if="!snapshot?.asks?.length && !snapshot?.bids?.length" class="muted">暂无挂单</p></section></template>
