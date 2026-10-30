import type { StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, at, recorded } from '../reaction-testing/playbook-writes.ts';
import { testMachine } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { mostOpenCallsOfATree } from './waiting-options.ts';
import { executorWaitingOf } from './waiting-parts.ts';

const run = { runId: 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', attributes: {} };

function callWith(arguments_: StartCall['arguments']): StartCall {
  return {
    kind: 'start_call',
    key: { runId: run.runId, reference: '/do/0/ask', run: 1 },
    function: 'notify',
    arguments: arguments_,
    longestMs: 60_000,
  };
}

const withoutChildren = {
  ...testMachine,
  functions: {
    argumentChecks: {},
    describe: () => 'a function',
    howAWorkflowReachesTheWorld: 'through its functions',
    howAWorkflowStarts: 'through its runtime',
  },
};

describe('the run a call waits for', () => {
  it('is the one its functions derive from the call, and none when they derive none', async () => {
    const { options } = recordedWaiting();
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const derived = executorWaitingOf(database, testMachine, options);
    const underived = executorWaitingOf(database, withoutChildren, options, 5);

    expect([
      derived.childOf(callWith({ to: 'ada' }), run),
      derived.childOf(callWith('ada'), run),
      underived.childOf(callWith({ to: 'ada' }), run),
    ]).toEqual(['notify at /do/0/ask #1', null, null]);
    expect([derived.mostOpen, underived.mostOpen]).toEqual([mostOpenCallsOfATree, 5]);
  });
});

describe('the answer of a run a call waits for', () => {
  it('is the ending of that run when it names the call, and none while it runs or names no call', async () => {
    const { options } = recordedWaiting();
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const { childAnswerOf } = executorWaitingOf(database, testMachine, options);
    const ofTheChild = {
      by: 'playbook:alpha',
      at,
      runId: 'the-child',
      definitionType: 'workflow',
      definitionName: 'check',
      definitionVersion: 1,
    };
    const calledBy = { runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', reference: '/do/0/ask', run: 1 };
    const checked = { type: 'run_succeeded', data: { output: 'checked', record: {} } };
    await recorded(database.store, `${alpha}runs/answered`, checked, { ...ofTheChild, calledBy });
    await recorded(database.store, `${alpha}runs/uncalled`, checked, ofTheChild);

    const answers = await Effect.runPromise(
      Effect.all(['answered', 'uncalled', 'running'].map((child) => childAnswerOf(run.runId, child))),
    );

    expect(answers).toEqual([{ status: 'succeeded', output: 'checked' }, undefined, undefined]);
  });
});
