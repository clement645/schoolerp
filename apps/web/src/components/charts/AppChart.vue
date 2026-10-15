<script setup lang="ts">
import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  RadarComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import type { EChartsOption } from 'echarts';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';

// Only the chart types the app draws are registered, keeping the bundle small.
use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TooltipComponent,
]);

const props = withDefaults(
  defineProps<{
    option: EChartsOption;
    /** What the chart shows, for people who cannot see it. */
    label: string;
    height?: string;
  }>(),
  { height: '18rem' },
);
</script>

<template>
  <div role="img" :aria-label="props.label" :style="{ height: props.height }">
    <VChart :option="props.option" autoresize class="size-full" />
  </div>
</template>
