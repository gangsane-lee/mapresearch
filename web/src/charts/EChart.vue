<script setup>
// ECharts 래퍼 (CLAUDE.md: echarts/core 모듈 단위 import, 래퍼 뒤에서만 사용 → 차트 라이브러리 교체 가능)
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, BarChart, ScatterChart, RadarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent } from 'echarts/components';
import VChart from 'vue-echarts';

use([CanvasRenderer, LineChart, BarChart, ScatterChart, RadarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent]);

defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '320px' },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: '데이터가 없습니다' },
});
</script>

<template>
  <div class="echart" :style="{ height }">
    <p v-if="empty" class="empty muted">{{ emptyText }}</p>
    <VChart v-else :option="option" autoresize />
  </div>
</template>

<style scoped>
.echart { width: 100%; position: relative; }
.empty { display: grid; place-items: center; height: 100%; margin: 0; border: 1px dashed var(--line); border-radius: var(--radius); }
</style>
