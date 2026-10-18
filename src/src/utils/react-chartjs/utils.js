
const defaultDatasetIdKey = 'label';

export function reforwardRef(ref, value) {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

export function setOptions(chart, nextOptions) {
  const options = chart.options;

  if (options && nextOptions) {
    Object.assign(options, nextOptions);
  }
}

export function setLabels(currentData, nextLabels) {
  currentData.labels = nextLabels;
}

export function setDatasets(
  currentData, nextDatasets, datasetIdKey = defaultDatasetIdKey,
) {
  const addedDatasets = [];

  currentData.datasets = nextDatasets.map(
    (nextDataset) => {
      // given the new set, find it's current match
      const currentDataset = currentData.datasets.find(
        (dataset) => dataset[datasetIdKey] === nextDataset[datasetIdKey],
      );

      // There is no original to update, so simply add new one
      if (
        !currentDataset
        || !nextDataset.data
        || addedDatasets.includes(currentDataset)
      ) {
        return { ...nextDataset };
      }

      addedDatasets.push(currentDataset);

      Object.assign(currentDataset, nextDataset);

      return currentDataset;
    },
  );
}

export function cloneData(data, datasetIdKey = defaultDatasetIdKey) {
  const nextData = {
    labels: [],
    datasets: [],
  };

  setLabels(nextData, data.labels);
  setDatasets(nextData, data.datasets, datasetIdKey);

  return nextData;
}

/**
 * Get dataset from mouse click event
 * @param chart - Chart.js instance
 * @param event - Mouse click event
 * @returns Dataset
 */
export function getDatasetAtEvent(chart, event) {
  return chart.getElementsAtEventForMode(
    event.nativeEvent,
    'dataset',
    { intersect: true },
    false,
  );
}

/**
 * Get single dataset element from mouse click event
 * @param chart - Chart.js instance
 * @param event - Mouse click event
 * @returns Dataset
 */
export function getElementAtEvent(chart, event) {
  return chart.getElementsAtEventForMode(
    event.nativeEvent,
    'nearest',
    { intersect: true },
    false,
  );
}

/**
 * Get all dataset elements from mouse click event
 * @param chart - Chart.js instance
 * @param event - Mouse click event
 * @returns Dataset
 */
export function getElementsAtEvent(chart, event) {
  return chart.getElementsAtEventForMode(
    event.nativeEvent,
    'index',
    { intersect: true },
    false,
  );
}
