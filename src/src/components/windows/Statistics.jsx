/*
 * Rankings Tabs
 */

/* eslint-disable max-len */

import { useMemo, useCallback, useContext } from 'preact/hooks';
import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import {
  shallowEqual, useSelector, useDispatch,
} from '../../store/react-redux/index.js';
import { t } from 'ttag';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LineController,
  ArcElement,
} from 'chart.js';
import { Line, Pie } from '../../utils/react-chartjs';

import Table from '../Table.jsx';
import { cdn } from '../../utils/utag.js';
import { fetchStats } from '../../store/actions/thunks.js';
import useInterval from '../hooks/interval.js';
import { numberToString, numberToStringFull } from '../../core/utils.js';
import { selectIsDarkMode } from '../../store/selectors/gui.js';
import { selectStats } from '../../store/selectors/ranks.js';
import WindowContext from '../context/window.js';
import {
  getCHistChartOpts,
  getCHistChartData,
  getOnlineStatsOpts,
  getOnlineStatsData,
  getHistChartOpts,
  getHistChartData,
  getCPieOpts,
  getCPieData,
  getPDailyStatsOpts,
  getPDailyStatsData,
} from '../../core/chartSettings.js';
import CooldownChanges from '../CooldownChanges.jsx';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  LineController,
  // for pie chart
  ArcElement,
);

const Rankings = () => {
  const lastStatsFetch = useSelector((state) => state.ranks.lastFetch);
  const [
    totalRanking,
    totalDailyRanking,
    factionRanking,
    dailyFactionRanking,
    dailyCRanking,
    prevTop,
    onlineStats,
    cHistStats,
    cHourlyStats,
    histStats,
    pDailyStats,
    pHourlyStats,
  ] = useSelector(selectStats, shallowEqual);
  const isDarkMode = useSelector(selectIsDarkMode);
  const dispatch = useDispatch();

  const {
    args: { activeTab = 'total' },
    setArgs,
    setTitle,
  } = useContext(WindowContext);

  const tabNames = {
    total: t`Total`,
    today: t`Today`,
    yesterday: t`Yesterday`,
    factionsTotal: t`Factions Total`,
    factionsToday: t`Factions Today`,
    countries: t`Countries Today`,
    charts: t`Charts`,
  };

  const setActiveTab = useCallback((tab) => {
    setArgs({
      activeTab: tab,
    });
    setTitle(tabNames[tab]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setArgs, setTitle]);

  useInterval(() => {
    if (Date.now() - 300000 > lastStatsFetch) {
      dispatch(fetchStats());
    }
  }, 300000);

  const [
    onlineOpts,
    histOpts,
    pDailyOpts,
    cHistOpts,
  ] = useMemo(() => {
    if (activeTab !== 'charts') {
      return [null, null, null, null];
    }
    return [
      getOnlineStatsOpts(isDarkMode),
      getHistChartOpts(isDarkMode),
      getPDailyStatsOpts(isDarkMode),
      getCHistChartOpts(isDarkMode),
    ];
  }, [activeTab, isDarkMode]);

  const cHistData = useMemo(() => {
    if (activeTab !== 'charts') {
      return null;
    }
    return getCHistChartData(cHistStats);
  }, [activeTab, cHistStats]);

  const onlineData = useMemo(() => {
    if (activeTab !== 'charts') {
      return null;
    }
    return getOnlineStatsData(onlineStats, pHourlyStats);
  }, [activeTab, onlineStats, pHourlyStats]);

  const histData = useMemo(() => {
    if (activeTab !== 'charts') {
      return null;
    }
    return getHistChartData(histStats);
  }, [activeTab, histStats]);

  const pDailyData = useMemo(() => {
    if (activeTab !== 'charts') {
      return null;
    }
    return getPDailyStatsData(pDailyStats);
  }, [activeTab, pDailyStats]);

  const cPieData = useMemo(() => {
    if (activeTab !== 'countries') {
      return null;
    }
    return getCPieData(dailyCRanking);
  }, [activeTab, dailyCRanking]);

  const cPieOpts = useMemo(() => {
    if (activeTab !== 'countries') {
      return null;
    }
    return getCPieOpts();
  }, [activeTab]);

  const tables = {
    total: totalRanking,
    today: totalDailyRanking,
    factionsTotal: factionRanking,
    factionsToday: dailyFactionRanking,
    yesterday: prevTop,
  };
  const availableTabs = Object.keys(tabNames);

  let content;

  if (tables[activeTab]) {
    const tableDescriptions = {
      total: t`Total Pixels per Player`,
      today: t`Daily Pixels per Player`,
      factionsTotal: t`Total Pixels per Faction`,
      factionsToday: t`Daily Pixels per Faction`,
      yesterday: t`Top 10 Players from Yesterday`,
    };
    const { rows, columnIds, types, uniqueColumnKey } = tables[activeTab];

    content = (
      <div className={`statwin-${activeTab}`} key={activeTab}>
        <h3>{tableDescriptions[activeTab]}</h3>
        <Table
          rows={rows}
          columnIds={columnIds}
          types={types}
          uniqueColumnKey={uniqueColumnKey}
          sortColumnKey={0}
        />
      </div>
    );
  } else if (activeTab === 'countries') {
    content = (
      <div className={`statwin-${activeTab}`} key={activeTab}>
        <CooldownChanges />
        <h3>{t`Daily Pixels per Country`}</h3>
        <div style={{ height: 300, paddingBottom: 16 }}>
          <Pie options={cPieOpts} data={cPieData} />
        </div>
        <table style={{ display: 'inline' }}>
          <thead>
            <tr>
              <th>#</th>
              <th>{t`Country`}</th>
              <th>
                Pixels&nbsp;
                <span className="c-last-hour">{t`+last hour`}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dailyCRanking.map((rank, ind) => (
              <tr key={rank.name}>
                <td>{ind + 1}</td>
                <td
                  title={rank.cc}
                  className="tab-cc-cell"
                >
                  <img
                    alt={rank.cc}
                    src={cdn`/cf/${rank.cc}.gif`}
                  />
                </td>
                <td className="c-num">
                  {numberToStringFull(rank.px)}
                  {(cHourlyStats[rank.cc] > 0) && (
                    <span className="c-last-hour">
                    &nbsp;+{numberToString(cHourlyStats[rank.cc])}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (activeTab === 'charts') {
    content = (
      <div className={`statwin-${activeTab}`} key={activeTab}>
        <Line options={cHistOpts} data={cHistData} />
        <Line options={onlineOpts} data={onlineData} />
        <Line options={pDailyOpts} data={pDailyData} />
        <Line options={histOpts} data={histData} />
      </div>
    );
  } else {
    content = (<h3>Unavailable</h3>);
  }

  return (
    <div className="content" key="factionpage">
      <div className="tab-container margin-container">
        {availableTabs.map((tab, ind) => (
          <Fragment key={tab}>
            <span
              role="button"
              tabIndex={-1}
              className={
                (activeTab === tab) ? 'modallink selected' : 'modallink'
              }
              onClick={() => setActiveTab(tab)}
            >{tabNames[tab]}</span>
            {(ind !== availableTabs.length - 1)
              && <span className="hdivider" />}
          </Fragment>
        ))}
        <div className="modaldivider" />
      </div>
      {content}
      <p>
        {t`Ranking updates every 5 min. Daily rankings get reset at midnight UTC.`}
      </p>
    </div>
  );
};

export default memo(Rankings);
