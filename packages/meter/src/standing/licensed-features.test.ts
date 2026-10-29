import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accountServiceLayer } from '../accounts/fetched-account-service.ts';
import { ledgerMeter } from '../licensing/self-hosted-meter.ts';
import { sqliteLedger } from '../testing/ledgers.ts';
import { LicensedFeatures, licensedFeaturesOf, type GivenFeatures } from './licensed-features.ts';

const noNetwork = () => Promise.reject(new TypeError('fetch failed: the tests reach no network'));

const use = { org: 'acme', feature: 'prediction-example', which: 'executes example models' };

const answered = Effect.flatMap(Effect.service(LicensedFeatures), (features) =>
  Effect.all([
    features.includes({ org: 'acme', feature: 'prediction-example' }),
    features.includes({ org: 'globex', feature: 'prediction-example' }),
    features.includes({ org: 'acme', feature: 'prediction-other' }),
    features.refusal(use),
  ]),
);

function answeredBy(layer: Layer.Layer<LicensedFeatures>) {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  return runtime.runPromise(answered);
}

function byOrg(org: string): Effect.Effect<readonly string[]> {
  return Effect.succeed(org === 'acme' ? ['prediction-example'] : []);
}

function givenBy(given?: GivenFeatures) {
  return answeredBy(licensedFeaturesOf(byOrg, given));
}

describe('the features of a composition that takes its entitlement from elsewhere', () => {
  it('are those it reads for the org of the work, and work that needs another is refused at the page of the runtime it names', async () => {
    const [acme, globex, other, refusal] = await givenBy({ runtime: 'runtime-1' });
    const page = 'https://studio.on.auto/licenses?installation=runtime-1';

    expect([acme, globex, other]).toEqual([true, false, false]);
    expect([refusal.kind, refusal.resolve_at, refusal.runtime_id, refusal.detail]).toEqual([
      'feature_unlicensed',
      page,
      'runtime-1',
      `This runtime's license does not include prediction-example, which executes example models. The account holder or an organization admin can add it at ${page}.`,
    ]);
  });

  it('are refused at the licenses page of the Studio it names, or of Auto’s, where it names no runtime', async () => {
    const [, , , named] = await givenBy({ studio: 'https://studio.example.com' });
    const [, , , unnamed] = await givenBy();

    expect([named.resolve_at, unnamed.resolve_at, unnamed.runtime_id]).toEqual([
      'https://studio.example.com/licenses',
      'https://studio.on.auto/licenses',
      undefined,
    ]);
  });
});

describe('the features of a self-hosted runtime', () => {
  it('are a service of the layer of its meter, none on without a key, whatever the org', async () => {
    const at = sqliteLedger();
    onTestFinished(() => at.remove());
    const account = accountServiceLayer({ origin: 'https://accounts.example.com', fetch: noNetwork });
    const [acme, globex] = await answeredBy(ledgerMeter().pipe(Layer.provide(at.layer()), Layer.provide(account)));

    expect([acme, globex]).toEqual([false, false]);
  });
});
