import { describe, expect, it } from 'vitest';

import {
  mostReceivedEventBytes,
  mostReceivedEvents,
  mostWaitingEventBytes,
  mostWaitingEvents,
} from '../machine/limits.ts';
import { testDriverOf } from '../pool-testing/test-sandbox.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId, drivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const waitingForever = workflow('do:\n  - await: { listen: { to: { one: { with: { type: never } } } } }');

const consumingForever = workflow('do:\n  - await: { listen: { to: { one: { with: { type: tick } } } }, then: await }');

function flooding(count: number, type: string, data = '') {
  return (driver: MemoryDriver, runId: string): void => {
    driver.at(1, () => {
      for (let index = 0; index < count; index += 1) {
        driver.deliver(runId, { id: `e${index}`, type, data });
      }
    });
  };
}

const waitingTitle = `The workflow was sent more events than it consumed: more than ${mostWaitingEvents} events or ${mostWaitingEventBytes} bytes waiting, the most a workflow holds`;

const receivedTitle = `The workflow was sent more than ${mostReceivedEvents} events or ${mostReceivedEventBytes} bytes of events, the most a workflow takes over its life`;

describe('the events a run has not consumed', () => {
  it(`may number ${mostWaitingEvents}; one more ends the run`, () => {
    const atTheLimit = drivenRun(waitingForever, { meanwhile: flooding(mostWaitingEvents, 'other') });
    const pastIt = drivenRun(waitingForever, { meanwhile: flooding(mostWaitingEvents + 1, 'other') });

    expect(atTheLimit.outcome).toMatchObject({ kind: 'overran' });
    expect(pastIt.outcome).toMatchObject({ kind: 'raised', error: { title: waitingTitle } });
    expect(pastIt.ended.inbox.waiting).toEqual([]);
  });

  it(`may take ${mostWaitingEventBytes} bytes; more ends the run`, () => {
    const run = drivenRun(waitingForever, { meanwhile: flooding(6, 'other', 'x'.repeat(200_000)) });

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { title: waitingTitle } });
  });
});

describe('the events a run receives over its life', () => {
  it(`may number ${mostReceivedEvents}, consumed or not; one more ends the run, which keeps the ids of the ${mostReceivedEvents} it took`, () => {
    const driver = testDriverOf();
    driver.start({ runId: drivenRunId, document: consumingForever });
    for (let index = 0; index < mostReceivedEvents; index += 1) {
      driver.deliver(drivenRunId, { id: index.toString(36), type: 'tick' });
    }
    const atTheLimit = driver.state(drivenRunId);
    driver.deliver(drivenRunId, { id: 'past', type: 'tick' });
    const pastIt = driver.state(drivenRunId);

    expect(atTheLimit.status).toBe('running');
    expect(atTheLimit.inbox.receivedIds).toHaveLength(mostReceivedEvents);
    expect(pastIt.outcome).toMatchObject({ kind: 'raised', error: { title: receivedTitle } });
    expect(pastIt.inbox).toMatchObject({ received: mostReceivedEvents, waiting: [] });
    expect(pastIt.inbox.receivedIds).toHaveLength(mostReceivedEvents);
  });

  it(`may take ${mostReceivedEventBytes} bytes, consumed or not`, () => {
    const run = drivenRun(consumingForever, { meanwhile: flooding(22, 'tick', 'x'.repeat(200_000)) });

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { title: receivedTitle } });
  });
});
