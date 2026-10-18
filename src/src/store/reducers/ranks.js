
const initialState = {
  lastFetch: 0,
  totalPixels: 0,
  dailyTotalPixels: 0,
  ranking: 1488,
  dailyRanking: 1488,
  // global stats
  /*
   * {
   *   total: totalUsersOnline,
   *   canvasId: onlineAtCanvas,
   * }
   */
  online: {
    total: 0,
  },
  // user all time
  totalRanking: {
    columnIds: [],
    types: [],
    rows: [],
    uniqueColumnKey: 2,
  },
  // user current day
  totalDailyRanking: {
    columnIds: [],
    types: [],
    rows: [],
    uniqueColumnKey: 2,
  },
  // faction all time
  factionRanking: {
    columnIds: [],
    types: [],
    rows: [],
    uniqueColumnKey: 2,
  },
  // faction current day
  dailyFactionRanking: {
    columnIds: [],
    types: [],
    rows: [],
    uniqueColumnKey: 2,
  },
  // countries current day
  dailyCRanking: [],
  // users top 10 of previous day
  prevTop: {
    columnIds: [],
    types: [],
    rows: [],
    uniqueColumnKey: 2,
  },
  // amount of users online hourly for past 7 days
  onlineStats: [],
  // countries daily past 14 days
  cHistStats: [],
  // countries hourly last 24 hours
  cHourlyStats: [],
  // top 10 players daily past 14 days
  histStats: { users: [], stats: [] },
  // amount of pixels placed daily for past 30 days
  pDailyStats: [],
  // amount of pixels placed hourly for past 7 days
  pHourlyStats: [],
  // cooldown changes per affected country
  cooldownChanges: {},
};

export default function ranks(
  state = initialState,
  action,
) {
  switch (action.type) {
    case 'REC_SET_PXLS': {
      const {
        rankedPxlCnt,
      } = action;
      if (!rankedPxlCnt) {
        return state;
      }
      let { totalPixels, dailyTotalPixels } = state;
      totalPixels += rankedPxlCnt;
      dailyTotalPixels += rankedPxlCnt;
      return {
        ...state,
        totalPixels,
        dailyTotalPixels,
      };
    }

    case 'REC_ONLINE': {
      const { online } = action;
      return {
        ...state,
        online,
      };
    }

    case 's/REC_ME':
    case 's/LOGIN': {
      const {
        totalPixels,
        dailyTotalPixels,
        ranking,
        dailyRanking,
      } = action;
      return {
        ...state,
        totalPixels,
        dailyTotalPixels,
        ranking,
        dailyRanking,
      };
    }

    case 'REC_STATS': {
      const lastFetch = Date.now();
      return {
        ...state,
        lastFetch,
        ...action.rankings,
      };
    }

    default:
      return state;
  }
}
