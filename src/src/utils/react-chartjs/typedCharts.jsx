import { forwardRef } from 'preact/compat';
import {
  Chart as ChartJS,
  LineController,
  BarController,
  RadarController,
  DoughnutController,
  PolarAreaController,
  BubbleController,
  PieController,
  ScatterController,
} from 'chart.js';

import { Chart } from './Chart.jsx';

function createTypedChart(type, registerables) {
  ChartJS.register(registerables);

  const ChartComponent = forwardRef(
    (props, ref) => <Chart {...props} ref={ref} type={type} />,
  );
  ChartComponent.displayName = `${type}chart`;
  return ChartComponent;
}

export const Line = createTypedChart('line', LineController);

export const Bar = createTypedChart('bar', BarController);

export const Radar = createTypedChart('radar', RadarController);

export const Doughnut = createTypedChart('doughnut', DoughnutController);

export const PolarArea = createTypedChart('polarArea', PolarAreaController);

export const Bubble = createTypedChart('bubble', BubbleController);

export const Pie = createTypedChart('pie', PieController);

export const Scatter = createTypedChart('scatter', ScatterController);
