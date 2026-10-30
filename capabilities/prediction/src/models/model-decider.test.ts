import { streamPrefixOfPlaybook } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelsStreamOf } from '../facts/model-facts.ts';
import { testPorts } from '../testing/prediction-ports.ts';
import { modelsDecider, type ModelCommand } from './model-decider.ts';

const sha256 = 'a'.repeat(64);

const acted = { at: '2026-10-12T09:00:00.000Z', by: 'playbook:alpha', name: 'daily-visits', definitionVersion: 1 };

const card = {
  build: 'build-1',
  trained_by: { id: 'acme-trainer', name: 'acme-trainer' },
  dataset: {
    data_sha256: sha256,
    training_sha256: sha256,
    scoring_sha256: sha256,
    rows: 48,
    series: 2,
    series_left_out: 0,
    first_period: '2026-09-16',
    last_period: '2026-10-09',
    window: 24,
    holdout: 8,
    checkpoint: null,
  },
  file: { sha256, bytes: 400, format: 'scripted', runtime: { name: 'scripted-runtime', version: '1.0.0' } },
  signature: {},
  scores: [],
  coverage: 0.8,
  against: [],
  baselines: [],
  rule: 'automatic' as const,
};

const predicted = {
  version: 1,
  of: 1,
  build: 'build-1',
  runtime: { name: 'scripted-runtime', version: '1.0.0' },
  origin: '2026-10-12',
  count: 2,
  missing: 0,
  predictions_sha256: sha256,
  predictions_bytes: 90,
};

const graded = {
  version: 1,
  of: 1,
  build: 'build-1',
  period: '2026-10-13',
  scores: [],
  graded: 2,
  answered: 2,
  missing: 0,
};

const verdict = { version: 1, build: 'build-1', metric: 'mase', challenger: null, active: null };

function ledgerOfModels() {
  const { ports } = testPorts();
  const stream = `${streamPrefixOfPlaybook({ org: 'acme', playbook: 'alpha' })}${modelsStreamOf('daily-visits')}`;
  return (command: ModelCommand) =>
    Effect.runPromise(
      Effect.result(
        Effect.map(
          ports.ledger.execute(stream, modelsDecider, command, { causationId: null, correlationId: null }),
          ({ version }) => version,
        ),
      ),
    );
}

type Executed = ReturnType<typeof ledgerOfModels>;

function inTurn(executed: Executed, commands: readonly ModelCommand[]): Promise<readonly unknown[]> {
  return commands.reduce<Promise<readonly unknown[]>>(
    async (before, command) => [...(await before), await executed(command)],
    Promise.resolve([]),
  );
}

describe('the models of a prediction function', () => {
  it('take each fact once: a version for its build, a prediction for its origin, a grade for its period and one verdict', async () => {
    const executed = ledgerOfModels();
    const commands: readonly ModelCommand[] = [
      { ...acted, type: 'build', card },
      { ...acted, type: 'predict', data: predicted },
      { ...acted, type: 'grade', data: graded },
      { ...acted, type: 'decide', passed: true, data: verdict },
    ];
    const first = await inTurn(executed, commands);
    const again = await inTurn(executed, commands);

    expect([first, again]).toEqual([
      [Result.succeed(1), Result.succeed(2), Result.succeed(3), Result.succeed(4)],
      [Result.succeed(4), Result.succeed(4), Result.succeed(4), Result.succeed(4)],
    ]);
  });

  it('activate a version once for its build, settle a build a caller activates before its end, and refuse once for a build', async () => {
    const executed = ledgerOfModels();
    await executed({ ...acted, type: 'build', card });
    const automatic = await executed({
      ...acted,
      type: 'activate',
      data: { version: 1, rule: 'automatic', build: 'build-1' },
    });
    const settledAlready = await executed({
      ...acted,
      type: 'activate',
      data: { version: 1, rule: 'automatic', build: 'build-1' },
    });
    await executed({ ...acted, type: 'build', card: { ...card, build: 'build-2' } });
    const requested = await executed({ ...acted, type: 'activate', data: { version: 2, rule: 'requested' } });
    const refusedOnce = await executed({
      ...acted,
      type: 'refuse',
      data: { version: 2, because: 'shadow_failed', build: 'build-2' },
    });

    expect([automatic, settledAlready, requested, refusedOnce]).toEqual([
      Result.succeed(2),
      Result.succeed(2),
      Result.succeed(4),
      Result.succeed(4),
    ]);
  });
});

describe('the models of a prediction function when a newer version is built', () => {
  it('refuse the activation of every version not yet settled as superseded when a newer one is built', async () => {
    const executed = ledgerOfModels();
    await executed({ ...acted, type: 'build', card });

    expect(await executed({ ...acted, type: 'build', card: { ...card, build: 'build-2' } })).toEqual(Result.succeed(3));
  });

  it('record no verdict of a version superseded meanwhile, so the newer version stays the one in its shadow', async () => {
    const executed = ledgerOfModels();
    await executed({ ...acted, type: 'build', card });
    await executed({ ...acted, type: 'build', card: { ...card, build: 'build-2' } });

    expect(await executed({ ...acted, type: 'decide', passed: false, data: verdict })).toEqual(Result.succeed(3));
  });
});
