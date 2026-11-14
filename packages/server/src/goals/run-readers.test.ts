import { measuredPoolSettings } from '@on.auto/definitions/testing';
import { mostConditionWork, runConditionsOf, runOutputsOf, type ConditionedRun } from '@on.auto/goals';
import { payloadKept, payloadReaderOf } from '@on.auto/operations/payloads';
import { mostExpressionWork } from '@on.auto/workflow-engine';
import { programPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { keptOf, ledgerContent } from '../testing/goals/run-samples.ts';

const owner = { org: 'acme', playbook: 'sales' };

const endedAt = Date.parse('2026-11-09T09:00:00Z');

const measured = '${ $data.status == "measured" }';

const twentyCheckpoints = '${ (() => { let t = 0; for (let i = 0; i < 100000; i += 1) { t += i; } return t > 0; })() }';

const neverEnds = '${ (() => { for (;;) {} })() }';

const unanswered = () => Effect.die(new Error('connect ECONNREFUSED'));

const pool = programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });

afterAll(() => pool.close());

const results = (count: number) => ({
  results: Array.from({ length: count }, (_, index) => ({ issue: `MAR-${index}`, status: 'measured' })),
});

function runOf(output: unknown, entries: ConditionedRun['entries']): ConditionedRun {
  return { record: 'record-1', ended_at: endedAt, output, entries };
}

describe('the output of a run on the server’s ledger', () => {
  it('reads the inline arm and its kept twin the same, and a kept payload the ledger never held as gone', async () => {
    const content = await ledgerContent();
    const output = { results: [{ issue: 'MAR-41', customers: 3, notes: 'n'.repeat(4000) }] };
    const kept = keptOf(output);
    const unkept = keptOf({ results: [{ notes: 'm'.repeat(4000) }] });
    await Effect.runPromise(payloadKept(content, owner, kept));
    const outputs = runOutputsOf(payloadReaderOf({ owner, content }));

    const read = await Effect.runPromise(
      Effect.all([
        outputs.outputOf({ record: 'inline', data: { output } }),
        outputs.outputOf({ record: 'kept', data: { output_sha256: kept.sha256, output_bytes: kept.bytes } }),
        outputs.outputOf({ record: 'unkept', data: { output_sha256: unkept.sha256, output_bytes: unkept.bytes } }),
      ]),
    );

    expect(read).toEqual([{ output }, { output }, { gone: 'not_held' }]);
    expect(outputs.reads()).toBe(2);
  });

  it('is tried again later when the content store does not answer', async () => {
    const content = await ledgerContent();
    const kept = keptOf({ notes: 'n'.repeat(4000) });
    await Effect.runPromise(payloadKept(content, owner, kept));
    const outputs = runOutputsOf(payloadReaderOf({ owner, content: { ...content, get: unanswered } }));

    const failure = await Effect.runPromise(
      Effect.flip(outputs.outputOf({ record: 'kept', data: { output_sha256: kept.sha256, output_bytes: kept.bytes } })),
    );

    expect(failure).toMatchObject({ _tag: 'unavailable' });
  });
});

describe('the conditions of a run on the server’s evaluation worker', () => {
  it('evaluates 800 conditions in one session at the run’s end, and refuses one that throws or never ends', async () => {
    const conditions = runConditionsOf(pool.evaluations.filters);
    const entries = Array.from({ length: 8 }, () => ({ when: measured, each: '/results' }));

    const verdicts = await Effect.runPromise(conditions.verdictsOf(runOf(results(100), entries)));
    const failing = await Effect.runPromise(
      runConditionsOf(pool.evaluations.filters).verdictsOf(
        runOf({}, [
          { when: '${ $data.nope.deeper }' },
          { when: neverEnds },
          { when: `\${ Date.now() == ${endedAt} }` },
        ]),
      ),
    );

    expect(verdicts).toEqual(entries.map(() => Array.from({ length: 100 }, () => true)));
    expect(conditions.spent()).toEqual({ sessions: 1, evaluations: 800, work: 800 });
    expect(failing).toEqual([
      [{ failed: "TypeError: cannot read property 'deeper' of undefined" }],
      [
        {
          failed: `The program did more work than it may: a condition may do ${mostExpressionWork} checkpoints of work`,
        },
      ],
      [true],
    ]);
  });

  it('cuts what the budget does not reach, at the same condition as the sandbox of any host', async () => {
    const conditions = runConditionsOf(pool.evaluations.filters);
    const entries = [
      { when: measured, each: '/results' },
      ...Array.from({ length: 7 }, () => ({ when: twentyCheckpoints, each: '/results' })),
    ];

    const verdicts = await Effect.runPromise(conditions.verdictsOf(runOf(results(100), entries)));

    expect(conditions.spent().sessions).toBe(1);
    expect(conditions.spent().work).toBeLessThanOrEqual(mostConditionWork);
    expect(verdicts.slice(0, 2)).toEqual([
      Array.from({ length: 100 }, () => true),
      Array.from({ length: 100 }, () => true),
    ]);
    expect(verdicts[2]).toHaveLength(conditions.spent().evaluations - 200);
    expect(conditions.spent()).toEqual({ sessions: 1, evaluations: 295, work: mostConditionWork });
    expect(verdicts.slice(3)).toEqual(Array.from({ length: 5 }, () => 'not_reached'));
  });
});
