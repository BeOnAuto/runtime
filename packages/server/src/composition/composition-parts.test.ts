import { LicensedFeatures, licensedFeaturesOf, type LicensedFeaturesPorts } from '@on.auto/meter';
import { Context, Effect, Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { InstalledPackages } from '../extensions/extension-loading.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import type { ComposedServerOptions } from '../server-options/composed-options.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { loopbackSettingsOver } from '../testing/servers/reasoning-server.ts';
import { compositionRootWith } from './composition-root.ts';
import { loggedModelAccess } from './served-reasoning.ts';

const entitled: ReadonlyMap<string, readonly string[]> = new Map([['acme', ['example-feature']]]);

const features = licensedFeaturesOf((org) => Effect.succeed(entitled.get(org) ?? []));

function packagesHolding(provides: readonly Readonly<Record<string, unknown>>[]): InstalledPackages {
  return {
    imported: () => Promise.resolve({ manifest: { name: '@acme/greeters', version: '1.0.0', provides } }),
    directoryOf: () => '/nowhere',
  };
}

function settingsListingTheGreeters(): Readonly<Record<string, string>> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return { ...loopbackSettingsOver(ledger), AUTO_RUNTIME_EXTENSIONS: '[{"package":"@acme/greeters"}]' };
}

interface Seeing {
  readonly options: ComposedServerOptions;
  readonly seen: () => readonly LicensedFeaturesPorts[];
}

function seeingTheFeatures(composition: ComposedServerOptions): Seeing {
  const seen: LicensedFeaturesPorts[] = [];
  return {
    options: {
      ...composition,
      composed: async (settings, telemetry, shippedFiles) => {
        const composed = await composition.composed(settings, telemetry, shippedFiles);
        const services = Layer.tap(composed.services, (context) =>
          Effect.sync(() => {
            seen.push(Context.get(context, LicensedFeatures));
          }),
        );
        return { ...composed, services };
      },
    },
    seen: () => seen,
  };
}

describe('a server composed with packages and the features of a license of its own', () => {
  it('loads the extension its settings list from those packages, and answers from those features', async () => {
    const seeing = seeingTheFeatures(
      compositionRootWith(loggedModelAccess, { installed: packagesHolding([]), features }),
    );

    const server = await startServer(settingsListingTheGreeters(), seeing.options);
    const answered = await Effect.runPromise(
      Effect.forEach(seeing.seen(), (licensed) =>
        Effect.all([
          licensed.includes({ org: 'acme', feature: 'example-feature' }),
          licensed.includes({ org: 'globex', feature: 'example-feature' }),
        ]),
      ),
    );
    await server.stop();

    expect(answered).toEqual([[true, false]]);
  });

  it('refuses to start for a listed extension that provides a point this release does not serve, naming the one it serves', async () => {
    const composition = compositionRootWith(loggedModelAccess, {
      installed: packagesHolding([{ point: 'capability/greeting', contract: 1, implementation: {} }]),
    });

    await expect(startServer(settingsListingTheGreeters(), composition)).rejects.toThrow(
      'The extension @acme/greeters is refused: it provides capability/greeting, a point this release does not serve; it serves capability/prediction',
    );
  });
});
