import type { EChartsOption } from 'echarts';

/** Chart colours, matching the design tokens in `styles/main.css`. */
export const CHART_COLORS = {
  primary: '#0b6b3a',
  info: '#2563eb',
  warning: '#f59e0b',
  danger: '#dc2626',
  success: '#16a34a',
  muted: '#64748b',
  line: '#e5e7eb',
} as const;

const PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.info,
  CHART_COLORS.warning,
  CHART_COLORS.danger,
  '#7c3aed',
  '#0891b2',
  '#db2777',
  CHART_COLORS.muted,
];

export interface Series {
  name: string;
  values: readonly (number | null)[];
  color?: string;
}

interface AxisChart {
  categories: readonly string[];
  series: readonly Series[];
  /** Upper bound of the value axis, e.g. 100 for percentages. */
  max?: number;
  /** Appended to values in tooltips and on the axis, e.g. `%`. */
  unit?: string;
}

const text = { color: CHART_COLORS.muted, fontFamily: 'inherit', fontSize: 12 };

function axes({ categories, max, unit = '' }: AxisChart): Pick<EChartsOption, 'xAxis' | 'yAxis'> {
  return {
    xAxis: {
      type: 'category',
      data: [...categories],
      axisLine: { lineStyle: { color: CHART_COLORS.line } },
      axisTick: { show: false },
      axisLabel: { ...text, interval: 0, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      max,
      min: 0,
      splitLine: { lineStyle: { color: CHART_COLORS.line } },
      axisLabel: { ...text, formatter: `{value}${unit}` },
    },
  };
}

function frame(chart: AxisChart): EChartsOption {
  const unit = chart.unit ?? '';
  return {
    color: PALETTE,
    grid: {
      left: 8,
      right: 16,
      top: chart.series.length > 1 ? 36 : 16,
      bottom: 4,
      containLabel: true,
    },
    legend: chart.series.length > 1 ? { top: 0, textStyle: text, icon: 'roundRect' } : undefined,
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => (typeof value === 'number' ? `${value}${unit}` : '—'),
    },
    ...axes(chart),
  };
}

export function barOption(chart: AxisChart): EChartsOption {
  return {
    ...frame(chart),
    series: chart.series.map((entry) => ({
      type: 'bar',
      name: entry.name,
      data: [...entry.values],
      barMaxWidth: 36,
      itemStyle: { borderRadius: [4, 4, 0, 0], color: entry.color },
    })),
  };
}

export function lineOption(chart: AxisChart): EChartsOption {
  return {
    ...frame(chart),
    series: chart.series.map((entry) => ({
      type: 'line',
      name: entry.name,
      data: [...entry.values],
      smooth: true,
      symbolSize: 8,
      connectNulls: true,
      lineStyle: { width: 3, color: entry.color },
      itemStyle: { color: entry.color },
    })),
  };
}

export function donutOption(slices: readonly { name: string; value: number }[]): EChartsOption {
  return {
    color: PALETTE,
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: text, icon: 'circle' },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        label: { formatter: '{b}', color: CHART_COLORS.muted },
        data: slices.map((slice) => ({ ...slice })),
      },
    ],
  };
}

export function radarOption(chart: {
  axes: readonly string[];
  series: readonly Series[];
  max: number;
}): EChartsOption {
  return {
    color: PALETTE,
    legend: { bottom: 0, textStyle: text, icon: 'roundRect' },
    tooltip: { trigger: 'item' },
    radar: {
      indicator: chart.axes.map((name) => ({ name, max: chart.max })),
      radius: '62%',
      center: ['50%', '46%'],
      axisName: text,
      splitLine: { lineStyle: { color: CHART_COLORS.line } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: CHART_COLORS.line } },
    },
    series: [
      {
        type: 'radar',
        data: chart.series.map((entry) => ({
          name: entry.name,
          // A radar has no gaps: a subject not sat is drawn at the centre.
          value: entry.values.map((value) => value ?? 0),
          areaStyle: { opacity: 0.12 },
          lineStyle: { width: 2 },
        })),
      },
    ],
  };
}
