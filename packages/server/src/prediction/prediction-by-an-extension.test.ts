import type { ShippedFiles } from '@on.auto/shipped-files';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import {
  besideTheRuntime,
  manifestSource,
  scratchPackages,
  type ScratchPackage,
} from '../testing/extensions/scratch-packages.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { patientWorkerPool } from '../testing/servers/worker-pools.ts';
import { dailyVisits } from './published-visits.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const unnamed = "{ name: 'prediction-function' }";

function forecastsFilling(name: string, contract = 2, guide = unnamed): ScratchPackage {
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
            record: { answered_by: '${name}' },
          }),
        ),
      mostActive: 1000,
    }),
  })`;
  return {
    name,
    module: [
      "import { defineCapability } from '@on.auto/definitions';",
      "import { datasetsProvidedOn, datasetTables } from '@on.auto/prediction';",
      "import { statementOf } from '@on.auto/workflow-host';",
      "import { Effect } from 'effect';",
      manifestSource(name, [
        `{ point: 'capability/prediction', contract: ${contract}, implementation: ${capability} }`,
      ]),
    ].join('\n'),
  };
}

function settingsListing(...names: readonly string[]): Readonly<Record<string, string>> {
  return {
    AUTO_RUNTIME_EXTENSIONS: JSON.stringify(names.map((name) => ({ package: name }))),
    AUTO_RUNTIME_ACME_FORECASTS_REGION: 'north',
    PREDICTION_MAX_FUNCTIONS: '7',
  };
}

function lackingTitle(name: string): ScratchPackage {
  return {
    name,
    module: manifestSource(name, [
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
  const server = await servingReasoning([], settingsListing(...fillings.map(({ name }) => name)), noNetwork, {
    installed: packages,
    ledger,
    programPoolOf,
    ...(shippedFilesOver === undefined ? {} : { shippedFilesOver }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return server;
}

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
      'The extension @acme/forecasts is refused: it provides capability/prediction built against contract 1, and this runtime accepts contracts 2 to 6',
    );
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
