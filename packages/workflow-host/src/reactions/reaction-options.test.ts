import type { RecordedStream } from '@on.auto/ledger';
import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { functionStartAnswered, startAnswered, StartRefused } from './reaction-options.ts';
import { reactionOfRun } from './run-attributes.ts';
import { workflowsOfRuns } from './run-workflows.ts';
import { StartRejected } from './start-rejected.ts';

type RecordedMessage = RecordedStream['messages'][number];

const playbookKey = 'playbook/acme/alpha/';

function contextOf(type: string, name: string) {
  return {
    by: 'acme-admin',
    at: 'now',
    runId: `r-${name}`,
    definitionType: type,
    definitionName: name,
    definitionVersion: 1,
  };
}

const started = { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} };

function startedRecord(type: string, name: string): RecordedMessage {
  return {
    type: 'run_started',
    data: started,
    context: contextOf(type, name),
    lineage: { id: `r-${name}-1`, causationId: null, correlationId: null },
  };
}

const firsts: ReadonlyMap<string, RecordedMessage> = new Map([
  [`${playbookKey}runs/r-close@1`, startedRecord('workflow', 'close')],
  [`${playbookKey}runs/r-sum@1`, startedRecord('reasoning', 'sum')],
]);

function counting() {
  const reads: string[] = [];
  const store = {
    messageAt: (stream: string, version: number) => {
      reads.push(`${stream.slice(playbookKey.length)}@${version}`);
      return Promise.resolve(firsts.get(`${stream}@${version}`));
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

describe('the workflow of a run', () => {
  it('is the name the run started, when it is a workflow, and is read once while it is remembered', async () => {
    const { store, reads } = counting();
    const workflowOf = workflowsOfRuns(store, 'workflow', 3);

    const workflows = await Effect.runPromise(
      Effect.forEach(['r-close', 'r-sum', 'r-unknown', 'r-close', 'r-other', 'r-close'], (runId) =>
        workflowOf(playbookKey, runId),
      ),
    );

    expect(workflows).toEqual(['close', undefined, undefined, 'close', undefined, 'close']);
    expect(reads()).toEqual(['runs/r-close@1', 'runs/r-sum@1', 'runs/r-unknown@1', 'runs/r-other@1', 'runs/r-close@1']);
  });
});
