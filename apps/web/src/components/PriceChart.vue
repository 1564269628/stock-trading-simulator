<script setup lang="ts">
import { computed } from 'vue'
import type { PricePoint } from '../types'
const props = defineProps<{ points: PricePoint[] }>()
const polyline = computed(() => { if (props.points.length < 2) return ''; const values = props.points.map(point => point.price); const min = Math.min(...values); const span = Math.max(...values) - min || 1; return props.points.map((point, index) => `${index / (props.points.length - 1) * 100},${100 - (point.price - min) / span * 85}`).join(' ') })
</script>
<template><div class="chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline v-if="polyline" :points="polyline" fill="none" stroke="#4da3ff" stroke-width="1.5" vector-effect="non-scaling-stroke" /></svg><span v-if="!polyline" class="muted">等待价格历史…</span></div></template>
