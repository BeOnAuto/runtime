import { licensedFeaturesOf } from '@on.auto/meter';
import { providedModelRuntime } from '@on.auto/prediction-contract';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { installedPackages, type InstalledPackages } from '../extensions/extension-loading.ts';
import { accountsServed, licensedServedBy, studio } from '../testing/accounts/licensed-server.ts';
import { servingReasoning } from '../testing/servers/reasoning-server.ts';
import { tallyCreated } from '../testing/servers/tally-server.ts';
import { askedBuild, candidateBytes, savedVisits, sentCandidate } from './build-calls.ts';

const testTimeoutMs = 90_000;

const seriesModels = new URL('./recipes/series-models.ts', import.meta.resolve('@on.auto/prediction-series'));

const gated = '@acme/gated-models';

const gatedManifest = {
  manifest: {
    name: gated,
    version: '1.0.0',
    provides: [
      providedModelRuntime({
        name: 'gated-runtime',
        version: '1.0.0',
        formats: ['gated'],
        capabilities: { features: true, given: true, totals: true },
        feature: 'prediction-onnx',
        binding: { kind: 'process', module: () => seriesModels },
      }),
    ],
  },
};

const installed: InstalledPackages = {
  imported: (name) => (name === gated ? Promise.resolve(gatedManifest) : installedPackages.imported(name)),
  directoryOf: (name) => installedPackages.directoryOf(name),
};

const entitled: ReadonlyMap<string, readonly string[]> = new Map([['acme', ['prediction-onnx']]]);

function featuresOf(org: string): Effect.Effect<readonly string[]> {
  return Effect.succeed(entitled.get(org) ?? []);
}

async function uploadedUnder(features: readonly string[]) {
  const accounts = await accountsServed();
  accounts.account.grant('acme', features);
  const server = await licensedServedBy(
    accounts,
    { AUTO_RUNTIME_LICENSE_KEY: accounts.key, AUTO_RUNTIME_EXTENSIONS: JSON.stringify([{ package: gated }]) },
    { installed },
  );
  await savedVisits(server);
  const build = await askedBuild(server);
  return sentCandidate(server, build, candidateBytes('visits-mean'), 'gated');
}

describe('a candidate for an extension whose model runtime needs a feature a composition gives', () => {
  it(
    'is checked by that runtime while the features the composition reads for its org include it',
    { timeout: testTimeoutMs },
    async () => {
      const features = licensedFeaturesOf(featuresOf);
      const server = await servingReasoning(
        [],
        { AUTO_RUNTIME_EXTENSIONS: JSON.stringify([{ package: gated }]) },
        undefined,
        { installed, features },
      );
      onTestFinished(() => server.stop());
      await tallyCreated(server);
      await savedVisits(server);
      const build = await askedBuild(server);

      expect(await sentCandidate(server, build, candidateBytes('visits-mean'), 'gated')).toMatchObject({ status: 200 });
    },
  );
});

describe('a candidate for an extension whose model runtime needs a feature of the license', () => {
  it('is checked by that runtime while the signed license lists the feature', { timeout: testTimeoutMs }, async () => {
    expect(await uploadedUnder(['prediction-onnx'])).toMatchObject({ status: 200, body: { format: 'gated' } });
  });

  it(
    'is refused while the signed license does not, at the page of the runtime',
    { timeout: testTimeoutMs },
    async () => {
      const page = `${studio}/licenses?installation=0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a`;

      expect(await uploadedUnder([])).toMatchObject({
        status: 409,
        body: {
          kind: 'feature_unlicensed',
          detail: `This runtime's license does not include prediction-onnx, which executes gated models. The account holder or an organization admin can add it at ${page}.`,
        },
      });
    },
  );
});
