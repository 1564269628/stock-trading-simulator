<script setup lang="ts">
import type { OrderBookSnapshot } from '../types'
defineProps<{ snapshot?: OrderBookSnapshot }>()
</script>
<template><section><h3>盘口</h3><table><tr><th>卖价</th><th>数量</th><th>单数</th></tr><tr v-for="level in snapshot?.asks" :key="`a-${level.price}`" class="down"><td>{{ level.price }}</td><td>{{ level.quantity }}</td><td>{{ level.orderCount }}</td></tr><tr><th>买价</th><th>数量</th><th>单数</th></tr><tr v-for="level in snapshot?.bids" :key="`b-${level.price}`" class="up"><td>{{ level.price }}</td><td>{{ level.quantity }}</td><td>{{ level.orderCount }}</td></tr></table></section>
</template>
