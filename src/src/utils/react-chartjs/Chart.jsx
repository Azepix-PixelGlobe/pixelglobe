import { useEffect, useRef } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import { Chart as ChartJS } from 'chart.js';

/* eslint-disable react-hooks/exhaustive-deps */

import {
  reforwardRef,
  cloneData,
  setOptions,
  setLabels,
  setDatasets,
} from './utils.js';

function ChartComponent(
  props, ref,
) {
  const {
    height = 150,
    width = 300,
    redraw = false,
    datasetIdKey,
    type,
    data,
    options,
    plugins = [],
    fallbackContent,
    updateMode,
    ...canvasProps
  } = props;
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const renderChart = () => {
    if (!canvasRef.current) return;

    chartRef.current = new ChartJS(canvasRef.current, {
      type,
      data: cloneData(data, datasetIdKey),
      options: options && { ...options },
      plugins,
    });

    reforwardRef(ref, chartRef.current);
  };

  const destroyChart = () => {
    reforwardRef(ref, null);

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
  };

  useEffect(() => {
    if (!redraw && chartRef.current && options) {
      setOptions(chartRef.current, options);
    }
  }, [redraw, options]);

  useEffect(() => {
    if (!redraw && chartRef.current) {
      setLabels(chartRef.current.config.data, data.labels);
    }
  }, [redraw, data.labels]);

  useEffect(() => {
    if (!redraw && chartRef.current && data.datasets) {
      setDatasets(chartRef.current.config.data, data.datasets, datasetIdKey);
    }
  }, [redraw, data.datasets]);

  useEffect(() => {
    if (!chartRef.current) return;

    if (redraw) {
      destroyChart();
      setTimeout(renderChart);
    } else {
      chartRef.current.update(updateMode);
    }
  }, [redraw, options, data.labels, data.datasets, updateMode]);

  useEffect(() => {
    if (!chartRef.current) return;

    destroyChart();
    setTimeout(renderChart);
  }, [type]);

  useEffect(() => {
    renderChart();

    return () => destroyChart();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      height={height}
      width={width}
      {...canvasProps}
    >
      {fallbackContent}
    </canvas>
  );
}

export const Chart = forwardRef(ChartComponent);
