import type { RecordedStream } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflowsOfRuns } from './run-workflows.ts';

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
