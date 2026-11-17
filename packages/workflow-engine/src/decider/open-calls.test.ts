import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callKeyText } from '../executor/call-key.ts';
import type { RunLimits } from '../machine/run-input.ts';
import type { ArmedTimer, RunState } from '../machine/run-state.ts';
import type { CallAnswer, Responder } from '../memory/memory-executor.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import type { PositionedEvent } from '../run-log/run-event.ts';
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

function endedRun(driver: MemoryDriver, runIdOpenCalls: string, document: Case['document']): RunState {
  driver.start({ runId: runIdOpenCalls, document, limits: { longestCallMs } });
  return driver.runUntilEnded(runIdOpenCalls);
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

const twoCalls = workflow(`
do:
  - both:
      fork:
        branches:
          - quick: { call: notify, with: { to: ada } }
          - slow: { call: notify, with: { to: grace } }
`);

const runId = '0199a3c4-7d2e-7c1a-9b3f-000000000061';

const pausingThenAsking = workflow('do:\n  - pause: { wait: PT1M }\n  - ask: { call: notify, with: { to: ada } }');

function startsIn(positioned: PositionedEvent | undefined) {
  return (positioned?.event.outputs ?? []).flatMap((output) =>
    output.kind === 'start_call' ? [{ reference: output.key.reference, longestMs: output.longestMs }] : [],
  );
}

function waitOf(positioned: PositionedEvent | undefined): string {
  const armed = (positioned?.event.outputs ?? []).flatMap((output) =>
    output.kind === 'arm_timer' && output.purpose === 'wait' ? [output.timerId] : [],
  );
  return String(armed[0]);
}

function deadlinesOf(limits: Partial<RunLimits>) {
  const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
  driver.start({ runId, document: twoCalls, limits });
  const [first] = Effect.runSync(driver.ports.runStore.eventsAfter(runId, 0));
  return (first?.event.outputs ?? []).flatMap((output) =>
    output.kind === 'start_call' ? [{ reference: output.key.reference, longestMs: output.longestMs }] : [],
  );
}

describe('every open call', () => {
  it.each(cases)(
    'has an armed call deadline no later than its start and the longest a call runs, and leaves none once it closes: $shape, $answer',
    ({ document, respond }) => {
      const driver = memoryDriver({ sandbox: testSandbox, respond });
      const runIdOpenCalls = '0199a3c4-7d2e-7c1a-9b3f-000000000033';
      const ended = endedRun(driver, runIdOpenCalls, document);
      const states = statesAlong(driver.ports.runStore.events(runIdOpenCalls));

      expect(ended.status).toBe('ended');
      expect(openCallsAlong(states).filter((open) => isUnguarded(open))).toEqual([]);
      expect(states.flatMap((state) => deadlinesLeftOver(state))).toEqual([]);
      expect(ended.calls).toEqual({});
      expect(ended.timers.armed).toEqual({});
    },
  );

  it('is answered by its deadline when the executor never answers, as a timeout that cancels it', () => {
    const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
    const runIdOpenCalls = '0199a3c4-7d2e-7c1a-9b3f-000000000034';
    const ended = endedRun(driver, runIdOpenCalls, aCall);

    expect(driver.clock.now() - ended.startedAt).toBe(longestCallMs);
    expect(ended.outcome).toEqual({
      kind: 'raised',
      error: {
        type: 'https://open-workflow-specification.org/spec/1.0.0/errors/timeout',
        status: 408,
        title: `The function notify did not finish within ${longestCallMs} ms, the most it may take`,
        instance: '/do/0/ask',
        cause: { status: 'timed_out', run_id: 'notify at /do/0/ask #1' },
      },
    });
    expect(driver.ports.executor.cancelled()).toEqual([
      { kind: 'cancel_call', key: { runId: runIdOpenCalls, reference: '/do/0/ask', run: 1 }, reason: 'deadline' },
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
    const runIdOpenCalls = '0199a3c4-7d2e-7c1a-9b3f-000000000035';
    driver.start({ runId: runIdOpenCalls, document: aCall, limits: { longestCallMs } });

    const wake = Effect.runSync(driver.engine.wake(runIdOpenCalls));
    const [key] = host.started();

    expect(wake).toEqual({ version: 1, dispatchedThrough: 1 });
    expect(host.started()).toEqual([key, key]);
    expect(driver.runUntilEnded(runIdOpenCalls).outcome).toEqual({ kind: 'completed', output: 'again' });
    expect(driver.ports.recordStore.settlementOf(runIdOpenCalls)).toEqual({ status: 'succeeded', output: 'again' });
  });
});

describe('the deadline of a call', () => {
  it('is the limit its task was given when the run started, and the run-wide one for a task given none', () => {
    expect(
      deadlinesOf({
        longestCallMs: 600_000,
        longestCallMsByTask: { '/do/0/both/fork/branches/0/quick': 70_000 },
      }),
    ).toEqual([
      { reference: '/do/0/both/fork/branches/0/quick', longestMs: 70_000 },
      { reference: '/do/0/both/fork/branches/1/slow', longestMs: 600_000 },
    ]);
  });

  it('is a millisecond at the least, for a call that starts when the run has no time left', () => {
    const driver = memoryDriver({ sandbox: testSandbox, respond: () => 'never' });
    driver.start({
      runId,
      document: pausingThenAsking,
      limits: { mostDurationMs: 60_000, longestCallMs: 600_000 },
    });
    const [first] = Effect.runSync(driver.ports.runStore.eventsAfter(runId, 0));
    driver.submit({
      kind: 'timer_fired',
      runId,
      at: Number(first?.event.receipt.at) + 90_000,
      timerId: waitOf(first),
    });
    const [, second] = Effect.runSync(driver.ports.runStore.eventsAfter(runId, 0));

    expect(startsIn(second)).toEqual([{ reference: '/do/1/ask', longestMs: 1 }]);
  });

  it('is cut to what the run has left to run', () => {
    expect(deadlinesOf({ mostDurationMs: 45_000, longestCallMs: 600_000 })).toEqual([
      { reference: '/do/0/both/fork/branches/0/quick', longestMs: 45_000 },
      { reference: '/do/0/both/fork/branches/1/slow', longestMs: 45_000 },
    ]);
  });
});
