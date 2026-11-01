import { runFactsOf, workRecorder } from '@on.auto/definitions';
import type { Ledger } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { forecastChecked } from '../testing/extensions/declared-facts.ts';
import {
  besideTheRuntime,
  manifestSource,
  scratchPackages,
  type ScratchPackage,
} from '../testing/extensions/scratch-packages.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { dailyVisits } from './published-visits.ts';

const declaredFacts = new URL('../testing/extensions/declared-facts.ts', import.meta.url).href;

const name = '@acme/forecasts';

const checkingForecasts: ScratchPackage = {
  name,
  module: [
    "import { defineCapability } from '@on.auto/definitions';",
    "import { Effect } from 'effect';",
    `import { forecastChecked } from '${declaredFacts}';`,
    manifestSource(name, [
      `{ point: 'capability/prediction', contract: 1, implementation: () => ({
        capability: defineCapability({
          type: 'prediction',
          title: 'Prediction',
          guide: { name: 'prediction-function' },
          noun: { one: 'prediction function', other: 'prediction functions' },
          describeOutput: () => 'The extension answered.',
          mediaType: 'text/markdown',
          parse: (source) => Effect.succeed(source),
          summarize: () => ({}),
          run: () => Effect.succeed({ finishesLater: true, record: {} }),
          finishesLater: true,
          facts: { onRuns: [forecastChecked], streams: [] },
        }),
      }) }`,
    ]),
  ].join('\n'),
};

const listingTheExtension = { AUTO_RUNTIME_EXTENSIONS: JSON.stringify([{ package: name }]) };

const runIdOf = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const typesOfTheEvents = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

type Installed = ReturnType<typeof scratchPackages>['packages'];

async function aRunThatRecordedTheExtensionsFact(ledger: TemporaryLedger, installed: Installed): Promise<string> {
  const served = Promise.withResolvers<Ledger['Service']>();
  const server = await servingReasoning([], listingTheExtension, noNetwork, {
    installed,
    ledger,
    ledgerOver: (kept) => {
      served.resolve(kept);
      return kept;
    },
  });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/prediction`, {
    body: { name: 'daily-visits', source: dailyVisits, diagram: 'none' },
  });
  const asked = await server.call('POST', `${alpha}/definitions/prediction/daily-visits/run`, {
    body: { input: { series: 'north' } },
  });
  const { run_id: id } = runIdOf(asked.body);
  await Effect.runPromise(
    workRecorder(await served.promise, runFactsOf([forecastChecked]))(
      { org: 'acme', playbook: 'alpha', id },
      { type: 'work', fact: { type: 'forecast_checked', data: { checked: true } } },
      { causationId: null, correlationId: id },
    ),
  );
  await server.stop();
  return id;
}

describe('a database a runtime records the facts an extension declares on runs in', () => {
  it('opens again while the extension is listed, which reads them, and is refused once it is not, naming their type', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const { packages } = scratchPackages([checkingForecasts], besideTheRuntime);
    const id = await aRunThatRecordedTheExtensionsFact(ledger, packages);

    const again = await servingReasoning([], listingTheExtension, noNetwork, { installed: packages, ledger });
    const history = await again.call('GET', `${alpha}/runs/${id}/history`);
    await again.stop();

    expect(history.status).toBe(200);
    expect(typesOfTheEvents(history.body).events.map(({ type }) => type)).toContain('forecast_checked');
    await expect(servingReasoning([], {}, noNetwork, { ledger })).rejects.toThrow(
      ', and holds facts of the type forecast_checked, which this version of Auto Runtime does not read: it was made by a newer version, or by an earlier version than this one carries forward, or by an extension that declares them and is no longer listed in extensions. If an extension that is no longer listed in extensions declares them, list it again and start Auto Runtime again.',
    );
  });
});
