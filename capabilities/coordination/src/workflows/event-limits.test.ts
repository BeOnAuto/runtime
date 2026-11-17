import {
  mostReceivedEventBytes,
  mostReceivedEvents,
  mostWaitingEventBytes,
  mostWaitingEvents,
} from '@on.auto/workflow-engine';
import { describe, expect, it } from 'vitest';

import type { MachineHost, WorkflowStart } from '../testing/machine-host.ts';
import type { RunSettlement } from '../testing/run-terms.ts';
import { interpret, workflow } from '../testing/workflows.ts';

const anyWords: unknown = expect.any(String);

const waitingForever = workflow(`
do:
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.never }
`);

const consumingForever = workflow(`
do:
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.tick }
      then: await
`);

function flooding(count: number, event: (index: number) => unknown) {
  return (start: WorkflowStart, fake: MachineHost): void => {
    fake.at(1000, () => {
      for (let index = 0; index < count; index += 1) {
        start.deliver(event(index));
      }
    });
  };
}

const ranUntilItsDeadline = {
  status: 'rejected',
  reason: 'cancelled',
  kind: 'overrun',
  detail: 'The workflow ran for 2592000000 ms, the most a workflow may run, and was stopped',
};

function rejectionDetailOf(settlement: RunSettlement | undefined): string {
  return settlement?.status === 'rejected' ? settlement.detail : '';
}

describe('events a workflow has not consumed', () => {
  it(`may number ${mostWaitingEvents}; one more fails the workflow, which settles at once`, async () => {
    const atTheLimit = await interpret(waitingForever, {
      started: flooding(mostWaitingEvents, (index) => ({ id: `e${index}`, type: 'com.acme.other' })),
    });
    const pastIt = await interpret(waitingForever, {
      started: flooding(mostWaitingEvents + 1, (index) => ({ id: `e${index}`, type: 'com.acme.other' })),
    });

    expect(atTheLimit.settlement).toEqual(ranUntilItsDeadline);
    expect(pastIt.settlement).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: `The workflow was sent more events than it consumed: more than ${mostWaitingEvents} events or ${mostWaitingEventBytes} bytes waiting, the most a workflow holds.`,
    });
  });
});

describe('events a workflow is sent over its life', () => {
  it(`may take ${mostReceivedEventBytes} bytes, even when each is consumed`, async () => {
    const data = 'x'.repeat(200_000);
    const { settlement } = await interpret(consumingForever, {
      started: (start, fake) => {
        for (let index = 0; index < 22; index += 1) {
          fake.at(1000 * (index + 1), () => {
            start.deliver({ id: `e${index}`, type: 'com.acme.tick', data });
          });
        }
      },
    });

    expect(rejectionDetailOf(settlement)).toContain(`${mostReceivedEventBytes} bytes of events`);
  });

  it('do not count what is not JSON, which the API never delivers', async () => {
    const { settlement } = await interpret(consumingForever, {
      started: flooding(mostReceivedEvents + 1, () => Number.NaN),
    });

    expect(settlement).toEqual(ranUntilItsDeadline);
  });

  it('are taken as long as each is consumed and the total stays within the limits', async () => {
    const { settlement } = await interpret(consumingForever, {
      started: (start, fake) => {
        for (let index = 0; index < 20; index += 1) {
          fake.at(1000 * (index + 1), () => {
            start.deliver({ id: `e${index}`, type: 'com.acme.tick', data: index });
          });
        }
      },
    });

    expect(settlement).toEqual(ranUntilItsDeadline);
  });
});

describe('a for loop', () => {
  it('runs its tasks once for each item, passing the output of one round to the next', async () => {
    const document = workflow(`
do:
  - total:
      for:
        in: $data.items
        each: item
        at: position
      do:
        - add:
            set: { sum: '\${ $data.sum + $item }', last: '\${ $position }' }
`);

    expect((await interpret(document, { input: { items: [1, 2, 3], sum: 0 } })).ending).toEqual({
      kind: 'completed',
      output: { sum: 6, last: 2 },
    });
  });

  it('names its item and index item and index unless told otherwise', async () => {
    const document = workflow(`
do:
  - collect:
      for: { in: '\${ $data.letters }' }
      do:
        - note:
            set: { seen: '\${ [...$data.seen, $item + String($index)] }' }
`);

    expect((await interpret(document, { input: { letters: ['a', 'b'], seen: [] } })).ending).toEqual({
      kind: 'completed',
      output: { seen: ['a0', 'b1'] },
    });
  });
});

describe('a for loop that stops', () => {
  it('stops when its while condition no longer holds', async () => {
    const document = workflow(`
do:
  - count:
      for: { in: $data.items }
      while: $data.count < 2
      do:
        - increment:
            set: { count: '\${ $data.count + 1 }' }
`);

    expect((await interpret(document, { input: { items: [1, 2, 3, 4], count: 0 } })).ending).toEqual({
      kind: 'completed',
      output: { count: 2 },
    });
  });
});

describe('a for loop that leaves', () => {
  it('stops at an exit, and ends the workflow at an end', async () => {
    const exiting = workflow(`
do:
  - loop:
      for: { in: $data.items }
      do:
        - stop:
            set: { stopped: '\${ $item }' }
            then: exit
  - after:
      set: { after: '\${ $data.stopped }' }
`);
    const ending = workflow(`
do:
  - loop:
      for: { in: $data.items }
      do:
        - stop:
            set: { stopped: '\${ $item }' }
            then: end
  - after:
      set: { after: never }
`);

    expect((await interpret(exiting, { input: { items: ['a', 'b'] } })).ending).toEqual({
      kind: 'completed',
      output: { after: 'a' },
    });
    expect((await interpret(ending, { input: { items: ['a', 'b'] } })).ending).toEqual({
      kind: 'completed',
      output: { stopped: 'a' },
    });
  });
});

describe('a for loop over no array', () => {
  it('raises a validation error when it is given no array', async () => {
    const document = workflow(`
do:
  - loop:
      for: { in: $data.missing }
      do: []
`);

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: anyWords,
    });
  });

  it('raises a validation error when it says nothing to iterate over', async () => {
    expect((await interpret(workflow('do:\n  - loop: { for: {}, do: [] }'))).settlement).toMatchObject({
      detail: 'for.in must give an array to iterate over, at the step loop.',
    });
  });
});
