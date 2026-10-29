import { providedModelRuntime, type ExtensionManifest, type ModelRuntime } from '@on.auto/prediction-contract';

import release from '../../../../package.json' with { type: 'json' };
import { seriesFormat } from '../recipes/recipe-schema.ts';

export const seriesRuntime: ModelRuntime = {
  name: 'series',
  version: release.version,
  formats: [seriesFormat],
  capabilities: { features: true, given: true, totals: true, calendar: true, fits: true },
  binding: { kind: 'inline', module: () => new URL('../recipes/series-models.ts', import.meta.url) },
};

export const manifest: ExtensionManifest = {
  name: '@on.auto/prediction-series',
  version: release.version,
  provides: [providedModelRuntime(seriesRuntime)],
};
