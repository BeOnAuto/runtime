import { runFactsOf, workRecorder } from '@on.auto/definitions';
import type { Ledger } from '@on.auto/operations';
import type { ShippedFiles } from '@on.auto/shipped-files';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import { forecastChecked } from '../testing/extensions/declared-facts.ts';
import {
  besideTheRuntime,
  manifestSource,
  type ScratchPackage,
  scratchPackages,
} from '../testing/extensions/scratch-packages.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { patientWorkerPool } from '../testing/servers/worker-pools.ts';
import { dailyVisits } from './published-visits.ts';

const closing: (() => Promise<void>)[] = [];

const unnamed = "{ name: 'prediction-function' }";

function forecastsFilling(namePredictionByAn: string, contract = 2, guide = unnamed, check = ''): ScratchPackage {
  const capability = `(ports) => ({
    ...datasetsProvidedOn(ports),
    capability: defineCapability({
      type: 'prediction',
      title: 'Prediction',
      guide: ${guide},
      noun: { one: 'prediction function', other: 'prediction functions' },
      describeOutput: () => 'The extension answered.',
      mediaType: 'text/markdown',
      parse: (source) => Effect.succeed(source),
      summarize: () => ({}),
      run: (_source, input) =>
        Effect.map(
          Effect.orDie(ports.database.read(statementOf(['SELECT COUNT(*) AS kept FROM ' + datasetTables.datasets], []))),
          (rows) => ({
            output: { question: input, most_functions: ports.mostFunctions, datasets: rows, region: ports.settings.get('REGION') },
            record: { answered_by: '${namePredictionByAn}' },
          }),
        ),
      mostActive: 1000,${check}
    }),
  })`;
  return {
    name: namePredictionByAn,
    module: [
      "import { defineCapability } from '@on.auto/definitions';",
      "import { InvalidInput } from '@on.auto/operations';",
      "import { datasetsProvidedOn, datasetTables } from '@on.auto/prediction';",
      "import { statementOf } from '@on.auto/workflow-host';",
      "import { Effect } from 'effect';",
      manifestSource(namePredictionByAn, [
        `{ point: 'capability/prediction', contract: ${contract}, implementation: ${capability} }`,
      ]),
    ].join('\n'),
  };
}

function settingsListing(...names: readonly string[]): Readonly<Record<string, string>> {
  return {
    AUTO_RUNTIME_EXTENSIONS: JSON.stringify(names.map((namePredictionByAn) => ({ package: namePredictionByAn }))),
    AUTO_RUNTIME_ACME_FORECASTS_REGION: 'north',
    PREDICTION_MAX_FUNCTIONS: '7',
  };
}

function lackingTitle(namePredictionByAn: string): ScratchPackage {
  return {
    name: namePredictionByAn,
    module: manifestSource(namePredictionByAn, [
      "{ point: 'capability/prediction', contract: 2, implementation: () => ({ capability: { type: 'prediction' } }) }",
    ]),
  };
}

type ShippedFilesOver = (files: ShippedFiles) => ShippedFiles;

async function servingWith(
  fillings: readonly ScratchPackage[],
  programPoolOf: ProgramPoolOf = patientWorkerPool,
  shippedFilesOver?: ShippedFilesOver,
): Promise<ReasoningServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const { packages } = scratchPackages(fillings, besideTheRuntime);
  const server = await servingReasoning(
    [],
    settingsListing(...fillings.map(({ name: namePredictionByAn }) => namePredictionByAn)),
    noNetwork,
    {
      installed: packages,
      ledger,
      programPoolOf,
      ...(shippedFilesOver === undefined ? {} : { shippedFilesOver }),
    },
  );
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return server;
}

const refusingInItsPlaybook = `
      check: (_source, _text, place) =>
        Effect.fail(new InvalidInput({ detail: 'Refused.', issues: [{ pointer: '/' + place.playbook, detail: 'Refused.' }] })),`;

const naming = `{ name: 'prediction-function', variables: { 'prediction.most_active': { value: ports.mostFunctions + ' functions', default: '32 functions' } } }`;

const predictionPage = 'docs/reference/prediction-format.md';

const namingTheValue = [
  '# Prediction function format',
  '',
  'A playbook keeps at most <span data-variable="prediction.most_active">30 functions</span> active.',
  '',
  '<div data-variable="prediction.most_active">',
  '',
  '```yaml',
  'most_active: 32 functions',
  '```',
  '',
  '</div>',
].join('\n');

const withThePageNamingTheValue: ShippedFilesOver = (files) => ({
  ...files,
  text: async (file) => {
    const text = await files.text(file);
    return file.path === predictionPage ? text.replace('# Prediction function format', namingTheValue) : text;
  },
});

async function guideOf(server: ReasoningServer): Promise<readonly [number, string]> {
  const answered = await fetch(`${server.origin}/v1/guides/prediction-function`);
  return [answered.status, await answered.text()];
}

const declaredFacts = new URL('../testing/extensions/declared-facts.ts', import.meta.url).href;

const name = '@acme/forecasts';

const checkingForecasts: ScratchPackage = {
  name,
  module: [
    "import { defineCapability } from '@on.auto/definitions';",
    "import { Effect } from 'effect';",
    `import { forecastChecked } from '${declaredFacts}';`,
    manifestSource(name, [
      `{ point: 'capability/prediction', contract: 2, implementation: () => ({
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

describe('prediction by an extension', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a question to a prediction function of a runtime an extension fills capability/prediction of', () => {
    it('is answered by the capability the extension makes from the ports of the runtime and its own settings, in place of the forecaster', async () => {
      const server = await servingWith([forecastsFilling('@acme/forecasts')]);
      await server.call('POST', `${alpha}/definitions/prediction`, {
        body: { name: 'daily-visits', source: dailyVisits, diagram: 'none' },
      });

      const answer = await server.call('POST', `${alpha}/definitions/prediction/daily-visits/run`, {
        body: { input: { series: 'north' } },
      });

      expect([answer.status, answer.body]).toEqual([
        200,
        expect.objectContaining({
          status: 'succeeded',
          output: { question: { series: 'north' }, most_functions: 7, datasets: [{ kept: 0 }], region: 'north' },
          record: { answered_by: '@acme/forecasts' },
        }),
      ]);
    });
  });

  describe('a runtime an extension fills capability/prediction of', () => {
    it('does not start for an extension built against another contract, naming it, the point and both contracts', async () => {
      await expect(servingWith([forecastsFilling('@acme/forecasts', 1)])).rejects.toThrow(
        'The extension @acme/forecasts is refused: it provides capability/prediction built against contract 1, and this runtime accepts contracts 2 to 9',
      );
    });

    it('starts for an extension built against an earlier contract, whose check is told the playbook a definition is saved in as before', async () => {
      const server = await servingWith([forecastsFilling('@acme/forecasts', 8, unnamed, refusingInItsPlaybook)]);

      const saved = await server.call('POST', `${alpha}/definitions/prediction`, {
        body: { name: 'daily-visits', source: dailyVisits, diagram: 'none' },
      });

      expect([saved.status, saved.body]).toEqual([
        422,
        expect.objectContaining({
          reason: 'invalid_input',
          errors: [expect.objectContaining({ pointer: '/source/alpha' })],
        }),
      ]);
    });

    it('does not start for an extension whose capability lacks a member, naming it, and closes the pool it opened', async () => {
      const closed: string[] = [];
      const recordingClose: ProgramPoolOf = (settings, handed) => {
        const pool = patientWorkerPool(settings, handed);
        return {
          ...pool,
          close: async () => {
            closed.push('pool');
            await pool.close();
          },
        };
      };

      await expect(servingWith([lackingTitle('@acme/forecasts')], recordingClose)).rejects.toThrow(
        'The extension @acme/forecasts is refused: its capability has no title',
      );
      expect(closed).toEqual(['pool']);
    });

    it('does not start for two extensions that fill it, naming both', async () => {
      await expect(
        servingWith([forecastsFilling('@acme/forecasts'), forecastsFilling('@globex/forecasts')]),
      ).rejects.toThrow(
        'The extensions @acme/forecasts and @globex/forecasts each fill capability/prediction, and one extension at most may fill it; keep one of them in extensions',
      );
    });
  });

  describe('the guide of a runtime an extension fills capability/prediction of', () => {
    it('says the value the operator set, where the page names it, though the page writes another default', async () => {
      const server = await servingWith(
        [forecastsFilling('@acme/forecasts', 6, naming)],
        patientWorkerPool,
        withThePageNamingTheValue,
      );

      const [status, guide] = await guideOf(server);

      expect(status).toBe(200);
      expect(guide).toContain('A playbook keeps at most 7 functions active.\n\n```yaml\nmost_active: 7 functions\n```');
      expect(guide).not.toMatch(/data-variable|30 functions|32 functions/u);
    });

    it('is served as its page is, of an extension built before a guide declared values', async () => {
      const server = await servingWith([forecastsFilling('@acme/forecasts', 5)]);

      const [status, guide] = await guideOf(server);

      expect([status, guide.startsWith('# Prediction function format\n')]).toEqual([200, true]);
    });
  });
});

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
