import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import type { CallKey } from '../executor/call-key.ts';
import { testDriverOf } from '../pool-testing/test-sandbox.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { outputsIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const awaiting: CallKey = { runId, reference: '/do/0/await', run: 1 };

type Offered = Parameters<MemoryDriver['offer']>[0];

interface Offering {
  readonly driver: MemoryDriver;
  readonly offer: (key: string, event: Offered['event'], listener?: CallKey) => ReturnType<MemoryDriver['offer']>;
  readonly state: () => ReturnType<MemoryDriver['state']>;
}

function offering(to: string, input: JsonObject = {}): Offering {
  const driver = testDriverOf();
  driver.start({ runId, document: workflow(`do:\n  - await: { listen: { to: ${to} } }`), input });
  return {
    driver,
    offer: (key, event, listener = awaiting) => driver.offer({ runId, key, listener, event }),
    state: () => driver.state(runId),
  };
}

describe('a listen task whose filter names a type', () => {
  it('arms a listener with its filters when it waits, takes an offer it accepts, and cancels the listener', () => {
    const run = offering('{ one: { with: { type: com.acme.closed, data: { region: eu } } } }');

    const submission = run.offer('record-1', { id: 'e1', type: 'com.acme.closed', data: { region: 'eu' } });

    expect(submission.outcome).toBe('applied');
    expect(run.state().outcome).toEqual({ kind: 'completed', output: [{ region: 'eu' }] });
    expect(outputsIn(run.driver.ports.runStore.events(runId)).map(({ kind }) => kind)).toEqual([
      'arm_timer',
      'arm_listener',
      'cancel_listener',
      'cancel_timer',
      'settle',
    ]);
    expect(outputsIn(run.driver.ports.runStore.events(runId))[1]).toEqual({
      kind: 'arm_listener',
      key: awaiting,
      filters: [{ type: 'com.acme.closed', data: { region: 'eu' } }],
    });
  });

  it('takes an offer that its filter accepts over the data of the event, and appends nothing for one it does not', () => {
    const run = offering('{ one: { with: { type: com.acme.closed, data: \'${ $data.region == "eu" }\' } } }');
    const before = run.driver.ports.runStore.events(runId).length;

    const declined = run.offer('record-1', { id: 'e1', type: 'com.acme.closed', data: { region: 'us' } });
    const unchanged = run.driver.ports.runStore.events(runId).length;
    const accepted = run.offer('record-2', { id: 'e2', type: 'com.acme.closed', data: { region: 'eu' } });

    expect([declined.outcome, unchanged - before, accepted.outcome]).toEqual(['stale', 0, 'applied']);
    expect(run.state().inbox).toMatchObject({ waiting: [], offeredIds: ['record-2'], received: 1 });
  });
});

describe('the offers a listen task takes once', () => {
  it('takes an offer once by its key, and none for a listen that has ended or never was', () => {
    const run = offering('{ one: { with: { type: go } } }');
    run.offer('record-1', { id: 'e1', type: 'go' });

    const again = run.offer('record-1', { id: 'e1', type: 'go' });
    const ended = run.offer('record-2', { id: 'e2', type: 'go' });

    expect([again.outcome, ended.outcome]).toEqual(['stale', 'stale']);
  });

  it('takes no offer for a listener the run never armed', () => {
    const run = offering('{ one: { with: { type: go } } }');

    const astray = run.offer('record-1', { id: 'e1', type: 'go' }, { ...awaiting, reference: '/do/0/elsewhere' });

    expect([astray.outcome, run.state().status]).toEqual(['stale', 'running']);
  });
});

describe('an offer a listen task does not take', () => {
  it('answers an offer whose check fails as stale, with why, rather than raising in the run', () => {
    const run = offering('{ one: { with: { type: go, data: \'${ (() => { throw new Error("no") })() }\' } } }');

    const submission = run.offer('record-1', { id: 'e1', type: 'go', data: 1 });

    expect([submission.outcome, typeof submission.declined]).toEqual(['stale', 'string']);
    expect(run.state().status).toBe('running');
  });

  it('leaves the run waiting and its inbox empty after offers meant for other runs', () => {
    const run = offering("{ one: { with: { type: go, data: '${ $data == 1 }' } } }");

    const outcomes = Array.from({ length: 65 }, (_, index) =>
      run.offer(`record-${index}`, { id: `e${index}`, type: 'go', data: 2 }),
    ).map(({ outcome }) => outcome);

    expect(new Set(outcomes)).toEqual(new Set(['stale']));
    expect(run.state().inbox).toMatchObject({ waiting: [], waitingBytes: 0, offeredIds: [], received: 0 });
  });

  it('keeps the keys of offers apart from the ids of events sent to it, so neither blocks the other', () => {
    const run = offering('{ all: [{ with: { type: a } }, { with: { type: b } }] }');

    run.driver.deliver(runId, { id: 'same', type: 'a' });
    const offered = run.offer('same', { id: 'same', type: 'b' });

    expect(offered.outcome).toBe('applied');
    expect(run.state().outcome).toEqual({ kind: 'completed', output: [null, null] });
  });
});
