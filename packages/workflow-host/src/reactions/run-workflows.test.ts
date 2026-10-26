import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflowsOfRuns } from './run-workflows.ts';

const playbookKey = 'playbook/acme/alpha/';

function startedRecord(type: string, name: string) {
  return {
    type: 'run_started',
    data: { started_by: { id: 'acme-admin', name: 'acme-admin' }, input: {} },
    context: {
      by: 'acme-admin',
      at: 'now',
      runId: `r-${name}`,
      definitionType: type,
      definitionName: name,
      definitionVersion: 1,
    },
  };
}

const streams: ReadonlyMap<string, readonly unknown[]> = new Map([
  [`${playbookKey}runs/r-close`, [startedRecord('workflow', 'close')]],
  [`${playbookKey}runs/r-sum`, [startedRecord('reasoning', 'sum')]],
]);

function counting() {
  const reads: string[] = [];
  const read = (stream: string) => {
    reads.push(stream.slice(playbookKey.length));
    return Promise.resolve({ messages: streams.get(stream) ?? [] });
  };
  return { read, reads: () => reads };
}

describe('the workflow of a run', () => {
  it('is the name the run started, when it is a workflow, and is read once while it is remembered', async () => {
    const { read, reads } = counting();
    const workflowOf = workflowsOfRuns(read, 'workflow', 3);

    const workflows = await Effect.runPromise(
      Effect.forEach(['r-close', 'r-sum', 'r-unknown', 'r-close', 'r-other', 'r-close'], (runId) =>
        workflowOf(playbookKey, runId),
      ),
    );

    expect(workflows).toEqual(['close', undefined, undefined, 'close', undefined, 'close']);
    expect(reads()).toEqual(['runs/r-close', 'runs/r-sum', 'runs/r-unknown', 'runs/r-other', 'runs/r-close']);
  });
});
