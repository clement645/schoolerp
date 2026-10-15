import { describe, expect, it } from 'vitest';
import { barOption, donutOption, lineOption, radarOption } from '../chart-options';

describe('chart options', () => {
  it('builds a bar chart with one series per entry and a bounded axis', () => {
    const option = barOption({
      categories: ['Maths', 'English'],
      series: [{ name: 'Mean', values: [60, 57.5] }],
      max: 100,
      unit: '%',
    });
    expect(option.xAxis).toMatchObject({ data: ['Maths', 'English'] });
    expect(option.yAxis).toMatchObject({ max: 100, min: 0 });
    expect(option.series).toMatchObject([{ type: 'bar', name: 'Mean', data: [60, 57.5] }]);
    // A single series needs no legend.
    expect(option.legend).toBeUndefined();
  });

  it('shows a legend once there is more than one series', () => {
    const option = lineOption({
      categories: ['Mid-term', 'End-term'],
      series: [
        { name: 'Mean', values: [60, 58.75] },
        { name: 'Pass rate', values: [80, null] },
      ],
    });
    expect(option.legend).toBeDefined();
    expect(option.series).toMatchObject([
      { type: 'line', data: [60, 58.75] },
      { type: 'line', data: [80, null], connectNulls: true },
    ]);
  });

  it('builds a donut from slices', () => {
    const option = donutOption([
      { name: 'A', value: 1 },
      { name: 'D', value: 2 },
    ]);
    expect(option.series).toMatchObject([
      {
        type: 'pie',
        data: [
          { name: 'A', value: 1 },
          { name: 'D', value: 2 },
        ],
      },
    ]);
  });

  it('draws a missing radar value at the centre', () => {
    const option = radarOption({
      axes: ['Maths', 'English'],
      series: [{ name: 'Amina', values: [90, null] }],
      max: 100,
    });
    expect(option.radar).toMatchObject({
      indicator: [
        { name: 'Maths', max: 100 },
        { name: 'English', max: 100 },
      ],
    });
    expect(option.series).toMatchObject([
      { type: 'radar', data: [{ name: 'Amina', value: [90, 0] }] },
    ]);
  });
});
