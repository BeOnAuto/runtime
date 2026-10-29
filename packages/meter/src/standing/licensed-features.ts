import type { Conflict, Unavailable } from '@on.auto/operations';
import { Context, Effect, Layer } from 'effect';

import { meterDefaults, type MeterOptions } from '../admission/metering.ts';
import { featureUnlicensed, type Licensing } from '../licensing/licensing.ts';
import { knownInstallationOf, readLicense } from './license-status.ts';

export interface FeatureAsked {
  readonly org: string;
  readonly feature: string;
}

export interface FeatureUse extends FeatureAsked {
  readonly which: string;
}

export interface LicensedFeaturesPorts {
  readonly includes: (asked: FeatureAsked) => Effect.Effect<boolean, Unavailable>;
  readonly refusal: (use: FeatureUse) => Effect.Effect<Conflict, Unavailable>;
}

export class LicensedFeatures extends Context.Service<LicensedFeatures, LicensedFeaturesPorts>()(
  '@on.auto/meter/LicensedFeatures',
) {}

export function heldFeaturesOf(licensing: Licensing): LicensedFeaturesPorts {
  return {
    includes: ({ feature }) => readLicense(licensing, ({ features }) => Effect.succeed(features.includes(feature))),
    refusal: (use) =>
      readLicense(licensing, (reading) =>
        Effect.succeed(featureUnlicensed(licensing.options, knownInstallationOf(reading), use)),
      ),
  };
}

export interface GivenFeatures {
  readonly studio?: MeterOptions['studio'];
  readonly runtime?: string;
}

export function licensedFeaturesOf(
  featuresOf: (org: string) => Effect.Effect<readonly string[], Unavailable>,
  { studio = meterDefaults.studio, runtime }: GivenFeatures = {},
): Layer.Layer<LicensedFeatures> {
  return Layer.succeed(LicensedFeatures, {
    includes: ({ org, feature }) => Effect.map(featuresOf(org), (features) => features.includes(feature)),
    refusal: (use) => Effect.succeed(featureUnlicensed({ studio }, runtime, use)),
  });
}
