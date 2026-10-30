import { describe, expect, it } from 'vitest';

import { taskNameOf } from '../dsl/tasks.ts';
import { isRecordedStep, type Step, type StepCause } from '../steps/step-entry.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRun, outputKindsIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { withoutUndone } from './run-events.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const inboxLists = /^\/inbox\/(?:receivedIds|waiting)(?:\/|$)/u;

function declinedThenApproved(driver: MemoryDriver, running: string): void {
  driver.at(1, () => {
    driver.deliver(running, { id: 'd', type: 'declined' });
  });
  driver.at(2, () => {
    driver.deliver(running, { id: 'a', type: 'approved' });
  });
}

describe('the outputs of an event', () => {
  it('leave out a listener the same input armed and cancelled, and keep one armed and cancelled apart', () => {
    const key = { runId, reference: '/do/0/await', run: 1 };
    const other = { runId, reference: '/do/1/await', run: 1 };

    expect(
      withoutUndone([
        { kind: 'arm_listener', key, filters: [] },
        { kind: 'cancel_listener', key },
        { kind: 'cancel_listener', key: other },
      ]),
    ).toEqual([{ kind: 'cancel_listener', key: other }]);
  });

  it('leave out a timer the same input armed and cancelled, such as the deadline of a run that ends at once', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'));

    expect(outputKindsIn(run.events)).toEqual(['settle']);
  });

  it('leave out a call the same input started and cancelled, and its deadline', () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - asking: { call: notify, with: { to: ada } }
          - refusing: { raise: { error: { type: https://example.com/refused, status: 409 } } }
`);

    expect(outputKindsIn(drivenRun(document).events)).toEqual(['settle']);
  });

  it('keep a cancel of what an earlier input armed or started', () => {
    const key = { runId, reference: '/do/0/ask', run: 1 };
    const outputs = [
      { kind: 'cancel_timer', runId, timerId: '1' },
      { kind: 'cancel_call', key },
      { kind: 'arm_timer', runId, timerId: '2', dueAt: 1, purpose: 'wait' },
    ] as const;

    expect(withoutUndone(outputs)).toEqual(outputs);
  });
});

function causeLine(cause: StepCause): string {
  return cause === 'input' ? 'input' : `${taskNameOf(cause.reference)} ${cause.outcome}`;
}

function stepLine(step: Step): string {
  return `${step.name} ${step.outcome} ${step.times} by ${causeLine(step.caused_by)}`;
}

describe('the steps of an event', () => {
  it('are one entry for each step the input moved, with how it ended the input, in the order the steps started', () => {
    const document = workflow(`
do:
  - outer:
      do:
        - inner: { set: { a: 1 } }
        - pause: { wait: PT1S }
`);
    const steps = drivenRun(document).events.map(({ event }) =>
      event.steps.filter((step) => isRecordedStep(step)).map((step) => stepLine(step)),
    );

    expect(steps).toEqual([
      ['outer started 1 by input', 'inner completed 1 by outer started', 'pause waiting 1 by inner completed'],
      ['pause completed 1 by pause waiting', 'outer completed 1 by outer started'],
    ]);
  });
});

describe('the patch of an event', () => {
  it('appends to a list that only grew, and replaces one that lost items', () => {
    const document = workflow('do:\n  - await: { listen: { to: { one: { with: { type: approved } } } } }');
    const run = drivenRun(document, { meanwhile: declinedThenApproved });
    const operations = run.events.map(({ event }) => event.patch.filter(({ path }) => inboxLists.test(path)));
    const event = { id: 'd', type: 'declined' };
    const declined = { event, bytes: JSON.stringify(event).length };

    expect(operations).toEqual([
      [],
      [
        { op: 'add', path: '/inbox/waiting/-', value: declined },
        { op: 'add', path: '/inbox/receivedIds/-', value: 'd' },
      ],
      [
        { op: 'replace', path: '/inbox/waiting', value: [] },
        { op: 'add', path: '/inbox/receivedIds/-', value: 'a' },
      ],
    ]);
  });
});
