import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, mostCallDepth } from '../index.ts';
import { answeringLaterMs, answeringNowMs, asking } from '../testing/asking.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const calledBy = { run_id: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/ask', run: 2 } as const;

const measuring = defineCapability({
  type: 'measuring',
  title: 'Measuring',
  guide: { name: 'measuring' },
  noun: { one: 'measure', other: 'measures' },
  describeOutput: () => 'It measured.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  longestRunOf: () => 42_000,
  run: (_source, _input, run) =>
    Effect.gen(function* () {
      const longest = [
        yield* run.longestRunOf('probe', 'plain'),
        yield* run.longestRunOf('measuring', 'itself'),
        yield* run.longestRunOf('probe', 'missing'),
        yield* run.longestRunOf('probe', 'retired'),
        yield* run.longestRunOf('nothing', 'at-all'),
        yield* run.longestRunFor('asking', 'approve', { now: true }),
        yield* run.longestRunFor('asking', 'approve', { campaign: 'Spring' }),
        yield* run.longestRunOf('asking', 'approve'),
        yield* run.longestRunFor('probe', 'plain', {}),
        yield* run.longestRunFor('nothing', 'at-all', {}),
      ];
      return { output: { longest: longest.map((ms) => ms ?? null), callDepth: run.callDepth }, record: {} };
    }),
});

async function playbookMeasuring() {
  const operations = definitionOperationsFor([measuring, probe().capability, asking]);
  const definitions = harness();
  const created = (type: string, name: string) =>
    definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type, name, source: 'text' }));
  await created('measuring', 'itself');
  await created('probe', 'plain');
  await created('asking', 'approve');
  await created('probe', 'retired');
  await definitions.call(operations.retireDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'retired' }));
  const measured = (depths: { readonly callDepth?: number; readonly calledBy?: typeof calledBy } = {}) =>
    definitions.call(operations.runDefinition, {
      ...toAlpha(acmeAdmin, { type: 'measuring', name: 'itself', run_id: runId }),
      ...depths,
    });
  return { ...definitions, ...operations, measured };
}

describe('a run that answers a call of another run', () => {
  it('records the call and how many calls are above it on its start, and sees that depth in its context', async () => {
    const { ledger, measured, run } = await playbookMeasuring();

    expect(await measured({ callDepth: 3, calledBy })).toMatchObject({
      output: { output: { callDepth: 3 } },
    });
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded(
          { org: 'acme', playbook: 'alpha' },
          { kind: 'run', run: runId },
          { order: 'asc', limit: 10 },
        ),
      ),
    );
    expect(records[0]).toMatchObject({
      type: 'run_started',
      context: {
        callDepth: 3,
        calledBy: { runId: calledBy.run_id, reference: calledBy.reference, run: calledBy.run },
      },
    });
  });

  it(`may be ${mostCallDepth} calls deep, and the ninth start is refused as a conflict that records nothing`, async () => {
    const deep = await playbookMeasuring();
    const deeper = await playbookMeasuring();

    expect(await deep.measured({ callDepth: mostCallDepth })).toMatchObject({ status: 'succeeded' });
    expect(await deeper.measured({ callDepth: mostCallDepth + 1 })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'This run would sit 9 calls below the run at the top of its tree, more than the 8 a run may: workflows that call workflows reach at most 8 calls deep',
    });
    expect(deeper.ledger.streamNames().filter((stream) => stream.includes('/runs/'))).toEqual([]);
  });
});

describe('the longest run of a definition, as a run resolves it', () => {
  it('is what the capability declares for the active latest version, for the input given or for any input, and nothing for one it cannot run', async () => {
    const { measured } = await playbookMeasuring();

    expect(await measured()).toMatchObject({
      output: {
        output: {
          longest: [
            600_000,
            42_000,
            null,
            null,
            null,
            answeringNowMs,
            answeringLaterMs,
            answeringLaterMs,
            600_000,
            null,
          ],
          callDepth: 0,
        },
      },
    });
  });
});
