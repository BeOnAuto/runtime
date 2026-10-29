import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { LicensedFeatures, licensedFeaturesOf } from '@on.auto/meter';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { unlicensed } from '../licensing/meter-layer.ts';
import { applicationLayer } from './application-layer.ts';

const entitled: ReadonlyMap<string, readonly string[]> = new Map([['acme', ['prediction-onnx']]]);

function featuresOf(org: string): Effect.Effect<readonly string[]> {
  return Effect.succeed(entitled.get(org) ?? []);
}

const included = Effect.flatMap(Effect.service(LicensedFeatures), (features) =>
  Effect.all([
    features.includes({ org: 'acme', feature: 'prediction-onnx' }),
    features.includes({ org: 'globex', feature: 'prediction-onnx' }),
  ]),
);

describe('the features of the license a composition gives', () => {
  it('take the place of the meter’s', async () => {
    const given = licensedFeaturesOf(featuresOf);
    const runtime = ManagedRuntime.make(
      applicationLayer(ledgerLayer({ fileName: ':memory:' }), { ...unlicensed, features: given }),
    );

    const answered = await runtime.runPromise(included);
    await runtime.dispose();

    expect(answered).toEqual([true, false]);
  });
});
