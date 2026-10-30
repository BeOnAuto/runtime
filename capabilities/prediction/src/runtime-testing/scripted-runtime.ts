import { Conflict, Unavailable } from '@on.auto/operations';
import type { ModelRuntime } from '@on.auto/prediction-contract';
import { Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';

const scriptedFormat = 'scripted';

export const scriptedRuntime: ModelRuntime = {
  name: 'scripted-runtime',
  version: '1.0.0',
  formats: [scriptedFormat],
  capabilities: { features: true, given: true, totals: true, fits: true },
  binding: { kind: 'process', module: () => new URL('./scripted-recipes.ts', import.meta.url) },
};

export const scriptedRuntimeThatFitsNothing: ModelRuntime = {
  ...scriptedRuntime,
  capabilities: { ...scriptedRuntime.capabilities, fits: false },
};

export const inlineScriptedRuntime: ModelRuntime = {
  ...scriptedRuntime,
  name: 'inline-scripted-runtime',
  capabilities: { ...scriptedRuntime.capabilities, calendar: true },
  binding: { kind: 'inline', module: () => new URL('./scripted-recipes.ts', import.meta.url) },
};

export const scriptedFeature = 'prediction-scripted';

export const licensedScriptedRuntime: ModelRuntime = {
  ...scriptedRuntime,
  name: 'licensed-scripted-runtime',
  formats: ['scripted-licensed'],
  feature: scriptedFeature,
};

export const licensesPage = 'https://studio.example.com/licenses';

export const licensedFormatFitter: ModelRuntime = {
  ...scriptedRuntime,
  name: 'licensed-format-fitter',
  binding: { kind: 'inline', module: () => new URL('./scripted-licensed-recipes.ts', import.meta.url) },
};

export interface ScriptedLicense {
  readonly features: readonly string[];
  readonly lapsesAfter?: number;
  readonly unreadableAfter?: number;
}

const unreadable = new Unavailable({ detail: 'The license could not be read', kind: 'meter_unavailable' });

export function scriptedFeaturesOf(license: ScriptedLicense): PredictionPorts['features'] {
  const { features, lapsesAfter = Infinity, unreadableAfter = Infinity } = license;
  const asked = { times: 0 };
  return {
    includes: ({ feature }) =>
      Effect.suspend(() => {
        asked.times += 1;
        return asked.times > unreadableAfter
          ? Effect.fail(unreadable)
          : Effect.succeed(asked.times <= lapsesAfter && features.includes(feature));
      }),
    refusal: ({ feature, which }) =>
      Effect.succeed(
        new Conflict({
          detail: `This runtime's license does not include ${feature}, which ${which}. The account holder or an organization admin can add it at ${licensesPage}.`,
          kind: 'feature_unlicensed',
          resolve_at: licensesPage,
        }),
      ),
  };
}
