import { describe, expect, it } from 'vitest';

import type { MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

type Delivery = readonly [number, { readonly id: string; readonly type: string; readonly data?: number | string }];

function delivering(...deliveries: readonly Delivery[]) {
  return (driver: MemoryDriver, runId: string): void => {
    for (const [milliseconds, event] of deliveries) {
      driver.at(milliseconds, () => {
        driver.deliver(runId, event);
      });
    }
  };
}

function listening(to: string, more = ''): ReturnType<typeof workflow> {
  return workflow(`
do:
  - await:
      listen:
        to: ${to}${more}
      timeout: { after: PT1M }
`);
}

describe('a listen task', () => {
  it('takes one event that matches and gives its data', () => {
    const run = drivenRun(listening('{ one: { with: { type: go } } }'), {
      meanwhile: delivering([1, { id: 'e1', type: 'stop', data: 1 }], [2, { id: 'e2', type: 'go', data: 2 }]),
    });

    expect(run.outcome).toEqual({ kind: 'completed', output: [2] });
  });

  it('takes an event that came before it listened', () => {
    const document = workflow(`
do:
  - pause: { wait: PT1S }
  - await: { listen: { to: { one: { with: { type: go } } } } }
`);

    expect(drivenRun(document, { meanwhile: delivering([1, { id: 'e1', type: 'go', data: 7 }]) }).outcome).toEqual({
      kind: 'completed',
      output: [7],
    });
  });

  it('takes any event that matches one of its filters', () => {
    const run = drivenRun(listening('{ any: [{ with: { type: a } }, { with: { type: b } }] }'), {
      meanwhile: delivering([1, { id: 'e1', type: 'b', data: 'second' }]),
    });

    expect(run.outcome).toEqual({ kind: 'completed', output: ['second'] });
  });

  it('takes an event for each of its filters, in their order, before it goes on', () => {
    const run = drivenRun(listening('{ all: [{ with: { type: a } }, { with: { type: b } }] }'), {
      meanwhile: delivering(
        [1, { id: 'e1', type: 'b', data: 2 }],
        [2, { id: 'e2', type: 'a', data: 1 }],
        [3, { id: 'e3', type: 'b', data: 3 }],
      ),
    });

    expect(run.outcome).toEqual({ kind: 'completed', output: [1, 2] });
  });
});

describe('a listen task that filters', () => {
  it('matches a property by an expression on its value', () => {
    const run = drivenRun(listening("{ one: { with: { type: tick, data: '${ $data > 2 }' } } }"), {
      meanwhile: delivering([1, { id: 'e1', type: 'tick', data: 1 }], [2, { id: 'e2', type: 'tick', data: 3 }]),
    });

    expect(run.outcome).toEqual({ kind: 'completed', output: [3] });
  });

  it('gives the whole event when it reads the envelope', () => {
    const run = drivenRun(listening('{ one: { with: { type: go } } }', '\n        read: envelope'), {
      meanwhile: delivering([1, { id: 'e1', type: 'go', data: 2 }]),
    });

    expect(run.outcome).toEqual({ kind: 'completed', output: [{ id: 'e1', type: 'go', data: 2 }] });
  });

  it('times out when no event matches', () => {
    const run = drivenRun(listening('{ one: { with: { type: go } } }'), {
      meanwhile: delivering([1, { id: 'e1', type: 'stop' }]),
    });

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 408 } });
    expect(run.ended.inbox.waiting).toEqual([]);
  });

  it('is not woken by a timer that is not its own', () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - await: { listen: { to: { one: { with: { type: go } } } } }
          - pause: { wait: PT1S }
`);

    const run = drivenRun(document, { meanwhile: delivering([2000, { id: 'e1', type: 'go', data: 1 }]) });

    expect(run.outcome).toEqual({ kind: 'completed', output: [[1], {}] });
  });
});
