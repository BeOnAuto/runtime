import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { functionStartAnswered, startAnswered, startedVersionOf, StartRefused } from './reaction-options.ts';
import { reactionOfRun } from './run-attributes.ts';
import { definitionsOfRuns } from './run-workflows.ts';
import { StartRejected } from './start-rejected.ts';

const playbookKey = 'playbook/acme/alpha/';

const definitionKey = 'definition/acme/0190a5b6-0000-7000-8000-000000000001/';

const runsOfTheDefinition = new Set(['runs/r-close', 'runs/r-sum']);

function counting() {
  const reads: string[] = [];
  const store = {
    holderOfStream: ({ stream }: { readonly stream: string }) => {
      reads.push(stream);
      return Promise.resolve(runsOfTheDefinition.has(stream) ? definitionKey : undefined);
    },
  };
  return { store, reads: () => reads };
}

describe('a start of a workflow, as its outcome answered it', () => {
  it('is taken when the run started', async () => {
    await expect(Effect.runPromise(startAnswered({ status: 'succeeded', output: {} }))).resolves.toBeUndefined();
  });

  it('is refused for now when the playbook cannot take it now, and rejected when it never will, with the kind and because of its rejection', async () => {
    const outcomes: readonly Outcome[] = [
      { status: 'failed', incident: 'i-1' },
      { status: 'rejected', reason: 'unavailable', detail: 'The meter cannot be reached', kind: 'meter_unavailable' },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The org has used today’s Free credits',
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
      },
      { status: 'rejected', reason: 'invalid_input', detail: 'The input is not what the workflow takes' },
    ];

    const failures = await Effect.runPromise(
      Effect.forEach(outcomes, (outcome) => Effect.flip(startAnswered(outcome))),
    );

    expect(failures).toStrictEqual([
      new StartRefused({ detail: 'The start failed with incident i-1' }),
      new StartRefused({ detail: 'The meter cannot be reached', kind: 'meter_unavailable' }),
      new StartRejected({
        detail: 'The org has used today’s Free credits',
        kind: 'credits_exhausted',
        because: 'free_daily_limit',
      }),
      new StartRejected({ detail: 'The input is not what the workflow takes' }),
    ]);
  });
});

describe('a start of a function host code asked for, as its outcome answered it', () => {
  it('is taken when a run stands under its id, also one that ended unanswered or cancelled, whose ending its own run tells', async () => {
    const outcomes: readonly Outcome[] = [
      { status: 'succeeded', output: {} },
      { status: 'rejected', reason: 'unanswered', detail: 'Nobody could be told', kind: 'undelivered' },
      { status: 'rejected', reason: 'cancelled', detail: 'No longer needed', kind: 'requested' },
    ];

    const answers = await Effect.runPromise(Effect.forEach(outcomes, functionStartAnswered));

    expect(answers).toStrictEqual([undefined, undefined, undefined]);
  });

  it('is refused for now or rejected as a start of a workflow is, for every other outcome', async () => {
    const outcomes: readonly Outcome[] = [
      { status: 'failed', incident: 'i-1' },
      { status: 'rejected', reason: 'conflict', detail: 'The function is paused', kind: 'paused' },
      { status: 'rejected', reason: 'invalid_input', detail: 'The input is not what the function takes' },
    ];

    const failures = await Effect.runPromise(
      Effect.forEach(outcomes, (outcome) => Effect.flip(functionStartAnswered(outcome))),
    );

    expect(failures).toStrictEqual([
      new StartRefused({ detail: 'The start failed with incident i-1' }),
      new StartRejected({ detail: 'The function is paused', kind: 'paused' }),
      new StartRejected({ detail: 'The input is not what the function takes' }),
    ]);
  });
});

describe('the reaction a run makes, read from its attributes', () => {
  it('names its workflow and version, the caller it acts as, its depth and its correlation', () => {
    expect([
      reactionOfRun({
        definition: { name: 'close', version: 2 },
        caller: { id: 'playbook:alpha' },
        depth: 3,
        lineage: { correlation: 'r-top' },
      }),
      reactionOfRun({ definition: { name: 'close', version: 2 }, caller: { id: 'acme-admin' } }),
    ]).toEqual([
      { workflow: 'close', version: 2, caller: 'playbook:alpha', depth: 3, correlation: 'r-top' },
      { workflow: 'close', version: 2, caller: 'acme-admin', depth: 0, correlation: undefined },
    ]);
  });

  it('fails as a defect on attributes it cannot read, which the host never writes', () => {
    expect(() => reactionOfRun({ org: 'acme' })).toThrow('definition');
  });
});

describe('the definition of a run', () => {
  it('is the key of the definition its run is filed under, read once while it is remembered', async () => {
    const { store, reads } = counting();
    const definitionOf = definitionsOfRuns(store, 3);

    const definitions = await Effect.runPromise(
      Effect.forEach(['r-close', 'r-sum', 'r-unknown', 'r-close', 'r-other', 'r-close'], (runId) =>
        definitionOf(playbookKey, runId),
      ),
    );

    expect(definitions).toEqual([definitionKey, definitionKey, undefined, definitionKey, undefined, definitionKey]);
    expect(reads()).toEqual(['runs/r-close', 'runs/r-sum', 'runs/r-unknown', 'runs/r-other', 'runs/r-close']);
  });
});

describe('the start a workflow version is asked for', () => {
  it('names the definition by the id of the key it is filed under, and by its name alone where the key names none', () => {
    const start = {
      org: 'acme',
      playbook: 'alpha',
      definitionKey,
      workflow: 'close',
      version: 2,
      runId: 'r-close',
      input: { month: '2026-10' },
      depth: 1,
      cause: 'e-1',
      trigger: { kind: 'event' as const, reference: '/schedule/on' },
    };

    expect([startedVersionOf(start), startedVersionOf({ ...start, definitionKey: playbookKey })]).toEqual([
      {
        type: 'workflow',
        name: 'close',
        version: 2,
        input: { month: '2026-10' },
        run_id: 'r-close',
        definition_id: '0190a5b6-0000-7000-8000-000000000001',
      },
      { type: 'workflow', name: 'close', version: 2, input: { month: '2026-10' }, run_id: 'r-close' },
    ]);
  });
});
