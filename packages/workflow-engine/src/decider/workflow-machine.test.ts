import { readFileSync } from 'node:fs';

import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { newRun } from '../machine/run-state.ts';
import { testMachine } from '../pool-testing/test-sandbox.ts';
import { evolveRun, stateInCurrentFormat } from '../run-log/run-fold.ts';
import { startedOf, testCancel } from '../testing/driver-inputs.ts';
import { drivenRunId as runId } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { workflowMachine } from './workflow-machine.ts';

const calling = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const corpusState = stateInCurrentFormat(
  1,
  Reflect.get(JSON.parse(readFileSync(new URL('../../corpus/format-1.json', import.meta.url), 'utf8')), 'state'),
);

describe('the workflow machine', () => {
  it('decides the same events for the same state and input', () => {
    const machine = workflowMachine(testMachine);
    const input = startedOf({ runId, document: calling }, 1_790_845_200_000);

    expect(machine.decide(input, newRun)).toEqual(machine.decide(input, newRun));
  });

  it('gives each decision the context its settings make of the attributes of the run, at the time of the input', () => {
    const machine = workflowMachine({
      ...testMachine,
      contextOf: (attributes, at) => ({ at, by: JSON.stringify(attributes['caller']) }),
    });
    const input = startedOf({ runId, document: calling, attributes: { caller: 'ada' } }, 1_790_845_200_000);
    const state = Result.getOrThrow(machine.decide(input, newRun)).reduce(
      (folded, event) => machine.evolve(folded, event),
      newRun,
    );

    expect([
      machine.context(input, newRun),
      machine.context({ kind: 'cancel_requested', runId, at: 1_790_845_201_000, cancel: testCancel }, state),
    ]).toEqual([
      { at: '2026-10-01T09:00:00.000Z', by: '"ada"' },
      { at: '2026-10-01T09:00:01.000Z', by: '"ada"' },
    ]);
  });
});

describe('the workflow machine, given functions that break', () => {
  it('dies, rather than ending the run, when the functions it was given break', () => {
    const machine = workflowMachine({
      ...testMachine,
      functions: {
        ...testMachine.functions,
        describe: () => {
          throw new Error('The description broke');
        },
      },
    });

    expect(() => machine.decide(startedOf({ runId, document: calling }, 0), newRun)).toThrow('The description broke');
  });

  it('applies an input to a run upcast from the format-1 corpus, which has no frame, without stepping a task', () => {
    const machine = workflowMachine(testMachine);
    const input = {
      kind: 'event_received',
      runId: corpusState.runId,
      at: corpusState.lastInputAt + 1,
      event: { id: 'corpus-event', type: 'com.acme.tick' },
    } as const;

    const events = Result.getOrThrow(machine.decide(input, corpusState));
    const after = events.reduce((state, event) => evolveRun(state, event), corpusState);

    expect(events.map(({ steps }) => steps)).toEqual([[]]);
    expect(after.inbox.receivedIds).toContain('corpus-event');
    expect(after.status).toBe('running');
  });
});
