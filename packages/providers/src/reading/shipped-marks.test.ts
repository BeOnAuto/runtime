import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { providersShippedRoots, readProviders } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

const readsThroughPost: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['adobe-analytics', ['runReport']],
  [
    'amazon-ads',
    [
      'QueryAdvertiserAccount',
      'QueryCampaign',
      'QueryAdGroup',
      'QueryAd',
      'QueryTarget',
      'QueryRecommendation',
      'AdsApiv1RetrieveReport',
    ],
  ],
  ['campaign-manager-360', ['dfareporting.dimensionValues.query', 'dfareporting.reports.compatibleFields.query']],
  [
    'google-ads',
    [
      'googleads.customers.googleAds.search',
      'googleads.customers.googleAds.searchStream',
      'googleads.googleAdsFields.search',
    ],
  ],
  [
    'google-analytics',
    [
      'analyticsdata.properties.runReport',
      'analyticsdata.properties.runPivotReport',
      'analyticsdata.properties.batchRunReports',
      'analyticsdata.properties.batchRunPivotReports',
      'analyticsdata.properties.runRealtimeReport',
      'analyticsdata.properties.checkCompatibility',
      'analyticsdata.properties.audienceExports.query',
    ],
  ],
  ['google-analytics-admin', ['analyticsadmin.properties.runAccessReport']],
  ['google-search-console', ['webmasters.searchanalytics.query', 'searchconsole.urlInspection.index.inspect']],
  ['search-ads-360', ['searchads360.customers.searchAds360.search', 'searchads360.searchAds360Fields.search']],
];

describe('the marks of the shipped providers', () => {
  it('mark reads the operations of an HTTP API that only read through POST, and mark no tool acts, which its method marks', () => {
    const marking = shipped.providers.filter(({ entry }) => entry.marks !== undefined);

    expect(marking.map(({ entry }) => [entry.name, entry.type, entry.marks])).toEqual(
      readsThroughPost.map(([name, reads]: readonly [string, readonly string[]]) => [name, 'openapi', { reads }]),
    );
  });
});
