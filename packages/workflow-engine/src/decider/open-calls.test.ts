import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callKeyText } from '../executor/call-key.ts';
import type { ArmedTimer, RunState } from '../machine/run-state.ts';
import type { CallAnswer, Responder } from '../memory/memory-executor.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import { memoryDriver, type MemoryDriver } from '../testing/memory-driver.ts';
import { statesAlong } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const longestCallMs = 60_000;

const aCall = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const documents = {
  'a call': aCall,
  'calls in a fork': workflow(`
do:
  - both:
      fork:
        branches:
          - first: { call: notify, with: { to: ada } }
          - second: { call: notify, with: { to: grace } }
          - third: { call: notify, with: { to: alan } }
`),
  'a call retried on what it raises': workflow(`
do:
  - guarded:
      try:
        - ask: { call: notify, with: { to: ada } }
      catch:
        errors: { with: { status: 503 } }
        retry: { delay: PT1S, limit: { attempt: { count: 3 } } }
`),
  'a call in a loop': workflow(`
do:
  - each:
      for: { in: '\${ [1, 2, 3] }' }
      do:
        - ask: { call: notify, with: { to: ada } }
`),
  'a call under a shorter timeout': workflow(
    'do:\n  - ask: { call: notify, with: { to: ada }, timeout: { after: PT10S } }',
  ),
  'a call that competes': workflow(`
do:
  - race:
      fork:
        compete: true
        branches:
          - slow: { call: notify, with: { to: ada } }
          - quick: { wait: PT5S }
`),
  'a call its timeout cancels, before a wait': workflow(`
do:
  - guarded:
      try:
        - ask: { call: notify, with: { to: ada }, timeout: { after: PT10S } }
      catch: {}
  - rest: { wait: PT1H }
`),
  'a call that loses a race, before a wait': workflow(`
do:
  - race:
      fork:
        compete: true
        branches:
          - slow: { call: notify, with: { to: ada } }
          - quick: { wait: PT5S }
  - rest: { wait: PT1H }
`),
};

const answers: Readonly<Record<string, () => CallAnswer>> = {
  'never answered': () => 'never',
  'answered later than it may run': () => ({ after: 2 * longestCallMs, result: { status: 'succeeded', output: 1 } }),
  unreachable: () => ({ after: 10, result: { status: 'unreachable', detail: 'the host is gone' } }),
  'answered at once': () => ({ result: { status: 'succeeded', output: 1 } }),
};

interface Case {
  readonly shape: string;
  readonly answer: string;
  readonly document: ReturnType<typeof workflow>;
  readonly respond: Responder;
}

interface Opened {
  readonly at: number;
  readonly state: RunState;
  readonly key: string;
}

interface DyingHost {
  readonly respond: Responder;
  readonly started: () => readonly string[];
  readonly onDeath: (act: () => void) => void;
}

const cases: readonly Case[] = Object.entries(documents).flatMap(
  ([shape, document]: readonly [string, Case['document']]) =>
    Object.entries(answers).map(([answer, respond]: readonly [string, Responder]) => ({
      shape,
      answer,
      document,
      respond,
    })),
);

function guards(timer: ArmedTimer, reference: string | undefined, at: number): boolean {
  return timer.purpose === 'call_deadline' && timer.reference === reference && timer.dueAt <= at + longestCallMs;
}

function isUnguarded({ at, state, key }: Opened): boolean {
  const reference = state.calls[key]?.reference;
  return !Object.values(state.timers.armed).some((timer) => guards(timer, reference, at));
}

function deadlinesLeftOver(state: RunState): readonly string[] {
  const open = new Set(Object.values(state.calls).map(({ reference }) => reference));
  return Object.values(state.timers.armed)
    .filter(({ purpose, reference }: ArmedTimer) => purpose === 'call_deadline' && !open.has(reference))
    .map(({ reference }: ArmedTimer) => reference);
}

function openCallsAlong(states: readonly RunState[]): readonly Opened[] {
  const openedAt = new Map<string, number>();
  return states.flatMap((state) =>
    Object.keys(state.calls).map((key) => {
      const at = openedAt.get(key) ?? state.lastInputAt;
      openedAt.set(key, at);
      return { at, state, key };
    }),
  );
}

function endedRun(driver: MemoryDriver, runId: string, document: Case['document']): RunState {
  driver.start({ runId, document, limits: { longestCallMs } });
  return driver.runUntilEnded(runId);
}

function hostThatDiesOnce(): DyingHost {
  const started: string[] = [];
  const death = { act: (): void => undefined };
  return {
    respond: (call) => {
      started.push(callKeyText(call.key));
      if (started.length > 1) {
        return { result: { status: 'succeeded', output: 'again' } };
      }
      death.act();
      return 'never';
    },
    started: () => started,
    onDeath: (act) => {
      death.act = act;
    },
  };
}

describe('every open call', () => {
  it.each(cases)(
    'has an armed call deadline no later than its start and the longest a call runs, and leaves none once it closes: $shape, $answer',
    ({ document, respond }) => {
      const driver = memoryDriver({ sandbox: testSandbox, respond });
      const runId = '0199a3c4-7d2e-7c1a-9b3f-000000000033';
      const ended = endedRun(driver, runId, document);
      const states = statesAlong(driver.ports.runStore.events(runId));

      expect(ended.status).toBe('ended');
      expect(openCallsAlong(states).filter((open) => isUnguarded(open))).toEqual([]);
      expect(states.flatMap((state) => deadlinesLeftOver(state))).toEqual([]);
      expect(ended.calls).toEqual({});
      expect(ended.timers.armed).toEqual({});
    },
  );

  it('is answered by its deadline when the executor never answers, as a timeout that cancels it', () => {
    const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
    const runId = '0199a3c4-7d2e-7c1a-9b3f-000000000034';
    const ended = endedRun(driver, runId, aCall);

    expect(driver.clock.now() - ended.startedAt).toBe(longestCallMs);
    expect(ended.outcome).toEqual({
      kind: 'raised',
      error: {
        type: 'https://open-workflow-specification.org/spec/1.0.0/errors/timeout',
        status: 408,
        title: `The function notify did not finish within ${longestCallMs} ms, the most it may take`,
        instance: '/do/0/ask',
      },
    });
    expect(driver.ports.executor.cancelled()).toEqual([
      { kind: 'cancel_call', key: { runId, reference: '/do/0/ask', run: 1 }, reason: 'deadline' },
    ]);
  });
});

describe('a call whose host died before the dispatch of its start finished', () => {
  it('is started again when the run is woken, and answered once', () => {
    const host = hostThatDiesOnce();
    const driver = memoryDriver({ sandbox: testSandbox, respond: host.respond });
    host.onDeath(() => {
      driver.ports.faults.failNext('arm_timer');
    });
    const runId = '0199a3c4-7d2e-7c1a-9b3f-000000000035';
    driver.start({ runId, document: aCall, limits: { longestCallMs } });

    const wake = Effect.runSync(driver.engine.wake(runId));
    const [key] = host.started();

    expect(wake).toEqual({ version: 1, dispatchedThrough: 1 });
    expect(host.started()).toEqual([key, key]);
    expect(driver.runUntilEnded(runId).outcome).toEqual({ kind: 'completed', output: 'again' });
    expect(driver.ports.recordStore.settlementOf(runId)).toEqual({ status: 'succeeded', output: 'again' });
  });
});
