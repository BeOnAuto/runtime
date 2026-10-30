import { describe, expect, it } from 'vitest';

import type { MachineHost } from '../testing/machine-host.ts';
import type { WorkflowStart } from '../testing/machine-host.ts';
import { interpret, workflow } from '../testing/workflows.ts';

function deliveringAt(...deliveries: readonly (readonly [number, object])[]) {
  return (start: WorkflowStart, fake: MachineHost): void => {
    for (const [milliseconds, event] of deliveries) {
      fake.at(milliseconds, () => {
        start.deliver(event);
      });
    }
  };
}

const approval = workflow(`
do:
  - await:
      listen:
        to:
          one:
            with: { type: com.acme.approval.decided, data: '\${ $data.request === "r-1" }' }
`);

describe('listening for one event', () => {
  it('waits for an event that matches, and outputs its data', async () => {
    const { ending } = await interpret(approval, {
      started: deliveringAt(
        [1000, { id: 'e1', type: 'com.acme.approval.decided', data: { request: 'r-2', approved: false } }],
        [2000, { id: 'e2', type: 'com.acme.other', data: { request: 'r-1' } }],
        [3000, { id: 'e3', type: 'com.acme.approval.decided', data: { request: 'r-1', approved: true } }],
      ),
    });

    expect(ending).toEqual({ kind: 'completed', output: [{ request: 'r-1', approved: true }] });
  });

  it('takes an event that arrived before it listened', async () => {
    const { ending } = await interpret(approval, {
      started: (start) => {
        start.deliver({ id: 'e1', type: 'com.acme.approval.decided', data: { request: 'r-1' } });
      },
    });

    expect(ending).toEqual({ kind: 'completed', output: [{ request: 'r-1' }] });
  });

  it('ignores an event delivered twice, and what is not an event', async () => {
    const document = workflow(`
do:
  - first: { listen: { to: { one: { with: { type: ping } } } } }
  - second: { listen: { to: { one: { with: { type: ping } } } }, timeout: { after: PT1M } }
`);

    const { settlement } = await interpret(document, {
      started: deliveringAt([1, { id: 'p1', type: 'ping' }], [2, { id: 'p1', type: 'ping' }], [3, { type: 'ping' }]),
    });

    expect(settlement).toMatchObject({ detail: 'The task did not finish within 60000 ms, at the step second.' });
  });
});

describe('an event delivered again with the id of one already taken', () => {
  it('is never taken, even when another event wakes a listener for its type', async () => {
    const document = workflow(`
do:
  - first: { listen: { to: { one: { with: { type: ping } } } } }
  - second: { listen: { to: { one: { with: { type: ping } } } } }
`);

    const { ending } = await interpret(document, {
      started: deliveringAt(
        [1, { id: 'a', type: 'ping', data: 'first a' }],
        [2, { id: 'a', type: 'ping', data: 'a again' }],
        [3, { id: 'b', type: 'pong', data: 'b' }],
        [4, { id: 'c', type: 'ping', data: 'c' }],
      ),
    });

    expect(ending).toStrictEqual({ kind: 'completed', output: ['c'] });
  });
});

describe('the attributes of an event', () => {
  it('are compared as JSON, an attribute the event lacks being null', async () => {
    const document = workflow(`
do:
  - await:
      listen:
        to:
          one:
            with: { type: order, subject: { id: 1 }, source: null }
`);

    const { ending } = await interpret(document, {
      started: deliveringAt(
        [1, { id: 'e1', type: 'order', subject: { id: 2 } }],
        [2, { id: 'e2', type: 'order', subject: { id: 1 }, data: 'match' }],
      ),
    });

    expect(ending).toEqual({ kind: 'completed', output: ['match'] });
  });
});

describe('listening for all events', () => {
  it('waits for an event of each filter, in any order, and reads whole events when told', async () => {
    const document = workflow(`
do:
  - await:
      listen:
        to:
          all:
            - with: { type: a }
            - with: { type: b }
        read: envelope
`);

    const { ending } = await interpret(document, {
      started: deliveringAt([1, { id: 'b1', type: 'b' }], [2, { id: 'a1', type: 'a', subject: 's' }]),
    });

    expect(ending).toEqual({
      kind: 'completed',
      output: [
        { id: 'a1', type: 'a', subject: 's' },
        { id: 'b1', type: 'b' },
      ],
    });
  });
});

describe('listening for any event', () => {
  it('takes the first event that matches any filter, and outputs null data when it has none', async () => {
    const document = workflow(`
do:
  - await:
      listen:
        to:
          any:
            - with: { type: yes }
            - with: { type: no }
`);

    const { ending } = await interpret(document, { started: deliveringAt([1, { id: 'n1', type: 'no' }]) });

    expect(ending).toEqual({ kind: 'completed', output: [null] });
  });

  it('raises an expression error when a filter fails on an event', async () => {
    const document = workflow(
      "do:\n  - await: { listen: { to: { one: { with: { data: '${ $data.a.toFixed(1) }' } } } } }",
    );

    const { settlement } = await interpret(document, {
      started: deliveringAt([1, { id: 'x', type: 'x', data: { a: 'text' } }]),
    });

    expect(settlement).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
  });
});
