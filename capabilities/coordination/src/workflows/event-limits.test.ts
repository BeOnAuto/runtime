import {
  mostReceivedEventBytes,
  mostReceivedEvents,
  mostWaitingEventBytes,
  mostWaitingEvents,
} from '@on.auto/workflow-engine';
import { describe, expect, it } from 'vitest';

import type { MachineHost } from '../testing/machine-host.ts';
import type { WorkflowStart } from '../testing/machine-host.ts';
import type { RunSettlement } from '../testing/run-terms.ts';
import { interpret, workflow } from '../testing/workflows.ts';

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
