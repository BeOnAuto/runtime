import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallKey } from '../executor/call-key.ts';
import { mostReceivedEvents } from '../machine/limits.ts';
import type { RunState } from '../machine/run-state.ts';
import { testDriverOf, testWorkflowMachine } from '../pool-testing/test-sandbox.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { workflow } from '../testing/workflows.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function outputKindsOf(driver: MemoryDriver): readonly string[] {
  return driver.ports.runStore.events(runId).flatMap(({ event }) => event.outputs.map(({ kind }) => kind));
}

const awaiting: CallKey = { runId, reference: '/do/0/await', run: 1 };

type Offered = Parameters<MemoryDriver['offer']>[0];

interface Offering {
  readonly driver: MemoryDriver;
  readonly offer: (key: string, event: Offered['event'], listener?: CallKey) => ReturnType<MemoryDriver['offer']>;
  readonly state: () => ReturnType<MemoryDriver['state']>;
}

function offering(to: string): Offering {
  const driver = testDriverOf();
  driver.start({ runId, document: workflow(`do:\n  - await: { listen: { to: ${to} } }`) });
  return {
    driver,
    offer: (key, event, listener = awaiting) => driver.offer({ runId, key, listener, event }),
    state: () => driver.state(runId),
  };
}

describe('a listen task that waits for all of its filters', () => {
  it('accepts offers in any order, each into the first filter not yet satisfied it fits, and hands them on in filter order', () => {
    const run = offering('{ all: [{ with: { type: a } }, { with: { type: b } }, { with: { type: a } }] }');

    run.offer('record-1', { id: 'e1', type: 'b', data: 2 });
    run.offer('record-2', { id: 'e2', type: 'a', data: 1 });
    const third = run.offer('record-3', { id: 'e3', type: 'b', data: 9 });
    run.offer('record-4', { id: 'e4', type: 'a', data: 3 });

    expect(third.outcome).toBe('stale');
    expect(run.state().outcome).toEqual({ kind: 'completed', output: [1, 2, 3] });
  });

  it('takes an offer once by its key, though the listen still waits', () => {
    const run = offering('{ all: [{ with: { type: a } }, { with: { type: b } }] }');
    run.offer('record-1', { id: 'e1', type: 'a' });

    const again = run.offer('record-1', { id: 'e1', type: 'b' });

    expect([again.outcome, run.state().inbox.offeredIds]).toEqual(['stale', ['record-1']]);
  });

  it('takes the events sent to it in any order too', () => {
    const run = offering('{ all: [{ with: { type: a } }, { with: { type: b } }] }');

    run.driver.deliver(runId, { id: 'e1', type: 'b', data: 2 });
    run.driver.deliver(runId, { id: 'e2', type: 'a', data: 1 });

    expect(run.state().outcome).toEqual({ kind: 'completed', output: [1, 2] });
  });
});

describe('a listen task with no filter that names a type', () => {
  it('arms no listener, so it sees only the events sent to its run', () => {
    const run = offering("{ one: { with: { data: '${ $data > 1 }' } } }");

    const offered = run.offer('record-1', { id: 'e1', type: 'go', data: 2 });

    expect(offered.outcome).toBe('stale');
    expect(outputKindsOf(run.driver)).not.toContain('arm_listener');
  });
});

describe('the listener of a listen task', () => {
  it('is never armed by a listen an event sent before it satisfied at once', () => {
    const driver = testDriverOf();
    const document = workflow(`
do:
  - pause: { wait: PT1S }
  - await: { listen: { to: { one: { with: { type: go } } } } }
`);
    driver.start({ runId, document });
    driver.deliver(runId, { id: 'e1', type: 'go' });

    const ended = driver.runUntilEnded(runId);

    expect(ended.outcome).toEqual({ kind: 'completed', output: [null] });
    expect(outputKindsOf(driver)).not.toContain('arm_listener');
  });

  it('is cancelled when the listen times out, and when the run ends while it listens', () => {
    const timedOut = testDriverOf();
    timedOut.start({
      runId,
      document: workflow(
        'do:\n  - await: { listen: { to: { one: { with: { type: go } } } }, timeout: { after: PT1M } }',
      ),
    });
    const cancelled = testDriverOf();
    cancelled.start({
      runId,
      document: workflow('do:\n  - await: { listen: { to: { one: { with: { type: go } } } } }'),
    });
    cancelled.cancel(runId);

    const states = [timedOut.runUntilEnded(runId), cancelled.runUntilEnded(runId)];

    expect(states.map(({ listeners }) => listeners)).toEqual([{}, {}]);
    expect(
      [timedOut, cancelled].map((driver) => outputKindsOf(driver).filter((kind) => kind.endsWith('_listener')).length),
    ).toEqual([2, 2]);
  });
});

describe('the offers a run accepts', () => {
  it('count toward the events it takes over its life, and the one past the bound ends it', () => {
    const run = offering('{ one: { with: { type: go } } }');
    const waiting = run.state();
    const full: RunState = { ...waiting, inbox: { ...waiting.inbox, received: mostReceivedEvents } };
    const offer = { runId, at: waiting.lastInputAt + 1, key: 'record-1', listener: awaiting };

    const events = Result.getOrThrow(
      testWorkflowMachine.decide({ ...offer, kind: 'event_offered', event: { id: 'e1', type: 'go' } }, full),
    );

    expect(events.reduce((state, event) => evolveRun(state, event), full).outcome).toMatchObject({
      kind: 'raised',
      error: { status: 500 },
    });
  });
});

describe('an offer to a listen nested in other tasks', () => {
  it('reaches a listen in a branch of a fork, in a try and in a loop', () => {
    const driver = testDriverOf();
    driver.start({
      runId,
      document: workflow(`
do:
  - both:
      fork:
        branches:
          - guarded:
              try:
                - each:
                    for: { in: '\${ [1] }' }
                    do:
                      - await: { listen: { to: { one: { with: { type: go } } } } }
              catch: {}
          - pause: { wait: PT1H }
`),
    });
    const listener = { runId, reference: '/do/0/both/fork/branches/0/guarded/try/0/each/do/0/await', run: 1 };

    const offered = driver.offer({ runId, key: 'record-1', listener, event: { id: 'e1', type: 'go' } });
    const elsewhere = driver.offer({
      runId,
      key: 'record-2',
      listener: { ...listener, reference: '/do/0/both/fork/branches/1/pause' },
      event: { id: 'e2', type: 'go' },
    });

    expect([offered.outcome, elsewhere.outcome]).toEqual(['applied', 'stale']);
  });

  it('is stale for a run whose state names a listener it holds no listen for', () => {
    const run = offering('{ one: { with: { type: go } } }');
    const waiting = run.state();
    const astray: RunState = { ...waiting, machine: { ...waiting.machine, root: null } };
    const offer = { runId, at: waiting.lastInputAt + 1, key: 'record-1', listener: awaiting };

    const events = Result.getOrThrow(
      testWorkflowMachine.decide({ ...offer, kind: 'event_offered', event: { id: 'e1', type: 'go' } }, astray),
    );

    expect(events).toEqual([]);
  });
});

describe('an event no branch of a fork takes', () => {
  it('leaves the fork as it was, while a branch that has finished and a branch that yields are passed over', () => {
    const driver = testDriverOf();
    driver.start({
      runId,
      document: workflow(`
do:
  - all:
      fork:
        branches:
          - await: { listen: { to: { one: { with: { type: go } } } } }
          - done: { set: {} }
          - busy:
              for: { in: '\${ Array.from({ length: 150 }, (_, index) => index) }' }
              do:
                - noop: { set: {} }
`),
    });
    const listener = { runId, reference: '/do/0/all/fork/branches/0/await', run: 1 };
    const before = driver.ports.runStore.events(runId).length;

    driver.deliver(runId, { id: 'e1', type: 'stop' });
    const offered = driver.offer({ runId, key: 'record-1', listener, event: { id: 'e2', type: 'go' } });

    expect([driver.ports.runStore.events(runId).length - before, offered.outcome]).toEqual([2, 'applied']);
  });
});
