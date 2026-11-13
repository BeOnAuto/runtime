export const slackLimitList = [
  { key: 'tables', most: 1, words: 'Tables in a card' },
  { key: 'charts', most: 2, words: 'Charts in a card' },
  { key: 'fields', most: 10, words: 'Field elements in one Fields' },
  { key: 'tableRows', most: 100, words: 'Rows in a Table' },
  { key: 'tableColumns', most: 20, words: 'Columns in a Table' },
  { key: 'chartLabel', most: 20, words: 'Characters in a chart label' },
  { key: 'chartTitle', most: 50, words: 'Characters in a Chart title' },
  { key: 'chartSeries', most: 12, words: 'Series in a chart' },
  { key: 'chartPoints', most: 20, words: 'Categories in a chart' },
] as const;

export const slackLimits = Object.fromEntries(slackLimitList.map(({ key, most }) => [key, most]));

export const slackShows = 'text, image, divider, fields, table, chart and link buttons';
