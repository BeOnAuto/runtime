import { describe, expect, it } from 'vitest';

import { type Json, type JsonObject, mostValueDepth } from '../dsl/json.ts';
import { errorType } from '../dsl/raised-error.ts';
import { nothingAtHand } from '../machine/held-contents.ts';
import { mostOutputBytes, mostStepsWithoutWaiting } from '../machine/limits.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import { testDriverOf, testMachine } from '../pool-testing/test-sandbox.ts';
import { testSettings } from '../testing/driver-inputs.ts';
import { armedTimersAlong, drivenRun, drivenRunId, outputKindsIn, outputsIn } from '../testing/run-history.ts';
import { at, openCall, runId, runningState, started } from '../testing/runs.ts';
import { workflow } from '../testing/workflows.ts';
import { deciding } from './deciding.ts';
import { decided } from './decision.ts';
import { endingEvent } from './run-endings.ts';

function nested(depth: number): Json {
  return depth === 0 ? 1 : [nested(depth - 1)];
}

function refusingEmpty(document: JsonObject, output: Json): string | undefined {
  return document['output'] !== undefined && output === null ? 'The output of the workflow is empty' : undefined;
}

function endedWithRefusals(document: JsonObject): RunState {
  const driver = testDriverOf({
    machine: { ...testSettings, functions: { ...testSettings.functions, outputRefusal: refusingEmpty } },
  });
  driver.start({ runId: drivenRunId, document });
  return driver.runUntilEnded(drivenRunId);
}

type HeldValues = RunState['machine']['values'];

type Held = HeldValues[string];

function readingThrows(values: HeldValues): HeldValues {
  return Object.fromEntries(
    Object.entries(values).map(([id, { bytes }]: readonly [string, Held]) => [
      id,
      Object.defineProperty({ bytes, value: null }, 'value', {
        enumerable: true,
        get: () => {
          throw new Error(`The value ${id} was read`);
        },
      }),
    ]),
  );
}

function digestOf(id: string): string {
  return id.repeat(64).slice(0, 64);
}

const watched: RunState = {
  ...runningState,
  machine: { ...runningState.machine, values: readingThrows(runningState.machine.values) },
};

const keptEverywhere: RunState = {
  ...runningState,
  machine: {
    ...runningState.machine,
    values: Object.fromEntries(
      Object.entries(runningState.machine.values).map(([id, { bytes }]: readonly [string, Held]) => [
        id,
        { sha256: digestOf(id), bytes },
      ]),
    ),
  },
};

const allMissing = new Map(
  Object.keys(runningState.machine.values).map((id) => [digestOf(id), { kind: 'missing' }] as const),
);

const inputs: readonly RunInput[] = [
  { kind: 'timer_fired', runId, at: at + 1, timerId: '1' },
  { kind: 'call_answered', runId, at: at + 1, key: openCall, result: { status: 'succeeded', output: 1 } },
  { kind: 'cancel_requested', runId, at: at + 1, cancel: { by: 'a', kind: 'requested', reason: 'r' } },
  { kind: 'event_received', runId, at: at + 1, event: { id: 'e', type: 't' } },
];

const gone = { type: 'runtime', status: 500, title: 'gone', instance: '/' };

const nothing = nothingAtHand();

function settledAs({ events }: ReturnType<typeof decided>): readonly string[] {
  return events.flatMap(({ outputs }) =>
    outputs.flatMap((output) => (output.kind === 'settle' ? [output.settlement.status] : [])),
  );
}

describe('the output of a run that the functions it is given refuse', () => {
  it('ends the run raised as a conflict of the kind unworkable, at the root, in the words of the refusal', () => {
    const ended = endedWithRefusals(workflow("output: { as: '${ null }' }\ndo:\n  - mark: { set: { done: true } }"));

    expect(ended.outcome).toEqual({
      kind: 'raised',
      error: {
        type: 'https://on.auto/problems/conflict',
        status: 409,
        title: 'The output of the workflow is empty',
        instance: '/',
        kind: 'unworkable',
      },
    });
  });

  it('leaves an output they take to complete the run', () => {
    expect(endedWithRefusals(workflow("output: { as: '${ 1 }' }\ndo: []")).outcome).toEqual({
      kind: 'completed',
      output: 1,
    });
  });
});

describe('a run', () => {
  it('reads its input through input.from and shapes its output through output.as', () => {
    const document = workflow(`
input: { from: '\${ ({ name: $data.who }) }' }
output: { as: '\${ ({ greeting: $data.greeting, by: $workflow.input.who }) }' }
do:
  - greet: { set: { greeting: '\${ "Hello, " + $data.name }' } }
`);

    expect(drivenRun(document, { input: { who: 'Ada' } }).outcome).toEqual({
      kind: 'completed',
      output: { greeting: 'Hello, Ada', by: 'Ada' },
    });
  });

  it('settles with the outcome it ends with, once, in its last event', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'));
    const settlement = { status: 'succeeded', output: { done: true } };

    expect(outputsIn(run.events)).toContainEqual({ kind: 'settle', runId: drivenRunId, settlement });
    expect(outputKindsIn(run.events).filter((kind) => kind === 'settle')).toHaveLength(1);
    expect(outputKindsIn(run.events.slice(-1)).at(-1)).toBe('settle');
  });

  it('raises a timeout when the whole document takes longer than its timeout', () => {
    const run = drivenRun(workflow('timeout: { after: PT1M }\ndo:\n  - pause: { wait: PT1H }'));
    const title = 'The task did not finish within 60000 ms';

    expect(run.outcome).toEqual({
      kind: 'raised',
      error: { type: errorType('timeout'), status: 408, title, instance: '/' },
    });
  });

  it('is stopped when it has run the most it may, and settles as cancelled for overrunning', () => {
    const document = workflow('do:\n  - first: { wait: PT40M }\n  - second: { wait: PT40M }');
    const run = drivenRun(document, { limits: { mostDurationMs: 3_600_000 } });

    expect(run.outcome).toEqual({ kind: 'overran', milliseconds: 3_600_000 });
    expect(run.driver.ports.recordStore.settlementOf(drivenRunId)).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'overrun',
      detail: 'The workflow ran for 3600000 ms, the most a workflow may run, and was stopped',
    });
  });
});

describe('a run that is cancelled or refused', () => {
  it('is cancelled when asked, cancels what it waits for as its parent ended, and settles as cancelled by who asked', () => {
    const cancel = { by: 'acme-admin', kind: 'requested', reason: 'Not needed any more' } as const;
    const run = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'), {
      respond: () => 'never',
      meanwhile: (driver, runIdRunLifecycle) => {
        driver.at(5, () => {
          driver.cancel(runIdRunLifecycle, cancel);
        });
      },
    });

    expect(run.outcome).toEqual({ kind: 'cancelled', cancel });
    expect(run.ended.cancelRequested).toBe(true);
    expect(outputKindsIn(run.events.slice(-1))).toEqual(['cancel_call', 'cancel_timer', 'cancel_timer', 'settle']);
    expect(run.events.at(-1)?.event.outputs[0]).toMatchObject({ kind: 'cancel_call', reason: 'parent_ended' });
    expect(run.events.at(-1)?.event.receipt).toMatchObject({ cancel: { by: 'acme-admin', kind: 'requested' } });
    expect(run.driver.ports.recordStore.settlementOf(drivenRunId)).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
      detail: 'Not needed any more',
      by: 'acme-admin',
    });
  });

  it('refuses a document this runtime does not run before it runs any task', () => {
    const run = drivenRun(workflow('do:\n  - shout: { run: { shell: { command: ls } } }'));

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: { status: 400, title: 'The workflow document is not allowed by this runtime', instance: '/' },
    });
  });

  it('raises when its input nests deeper than a value may', () => {
    const run = drivenRun(workflow('do:\n  - greet: { set: { done: true } }'), {
      input: { deep: nested(mostValueDepth + 1) },
    });

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: { title: `A value nests more than ${mostValueDepth} levels deep` },
    });
  });
});

describe('a run that does too much', () => {
  it('ends oversized when its output is larger than a run records', () => {
    const run = drivenRun(workflow("do:\n  - big: { set: '${ ({ text: $data.text }) }' }"), {
      input: { text: 'x'.repeat(mostOutputBytes) },
    });

    expect(run.outcome).toEqual({ kind: 'oversized', bytes: mostOutputBytes + 11, most: mostOutputBytes });
  });

  it(`raises once it ran ${mostStepsWithoutWaiting} tasks without waiting, a constant of the machine only the test sandbox lowers`, () => {
    const document = workflow("do:\n  - spin: { for: { in: '${ $data.items }' }, do: [{ step: { set: {} } }] }");
    const items = Array.from({ length: 50 }, (_item, index) => index);

    expect(mostStepsWithoutWaiting).toBe(10_000);
    expect(drivenRun(document, { input: { items }, stepsWithoutWaiting: 40 }).outcome).toMatchObject({
      kind: 'raised',
      error: { title: 'The workflow ran 40 tasks without waiting for anything; it would never end' },
    });
    expect(
      drivenRun(document, { input: { items: items.slice(0, 30) }, stepsWithoutWaiting: 40 }).outcome,
    ).toMatchObject({
      kind: 'completed',
    });
  });
});

describe('a task', () => {
  it('is skipped when its condition does not hold, and keeps its input', () => {
    const document = workflow("do:\n  - maybe: { if: '${ $data.go }', set: { went: true } }");

    expect(drivenRun(document, { input: { go: false } }).outcome).toEqual({ kind: 'completed', output: { go: false } });
    expect(drivenRun(document, { input: { go: true } }).outcome).toEqual({ kind: 'completed', output: { went: true } });
  });

  it('reads its input through input.from, shapes its output and exports to the context', () => {
    const document = workflow(`
do:
  - first:
      input: { from: '\${ $data.value }' }
      set: '\${ ({ doubled: $data * 2 }) }'
      output: { as: '\${ $data.doubled }' }
      export: { as: '\${ ({ first: $data }) }' }
  - second: { set: '\${ ({ seen: $context.first, input: $data }) }' }
`);

    expect(drivenRun(document, { input: { value: 4 } }).outcome).toEqual({
      kind: 'completed',
      output: { seen: 8, input: 8 },
    });
  });

  it('raises a timeout when it takes longer than its own', () => {
    const run = drivenRun(workflow('do:\n  - pause: { wait: PT1H, timeout: { after: PT1S } }'));

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 408, instance: '/do/0/pause' } });
  });

  it('uses a timeout the document names under use.timeouts, and raises one it does not name', () => {
    const named = workflow(
      'use:\n  timeouts:\n    short: { after: PT1S }\ndo:\n  - pause: { wait: PT1H, timeout: short }',
    );
    const missing = workflow('do:\n  - pause: { wait: PT1H, timeout: missing }');

    expect(drivenRun(named).outcome).toMatchObject({ kind: 'raised', error: { status: 408 } });
    expect(drivenRun(missing).outcome).toMatchObject({
      kind: 'raised',
      error: { title: 'use.timeouts has no timeout missing' },
    });
  });
});

describe('a task that raises before it waits', () => {
  it('leaves no timeout armed, whether its body or the reading of its input raised', () => {
    const document = workflow(`
do:
  - first:
      try:
        - reject: { raise: { error: { type: x, status: 400 } }, timeout: { after: PT1M } }
      catch: {}
  - second:
      try:
        - misread: { set: { a: 1 }, input: { from: '\${ (() => { throw new Error("unreadable") })() }' }, timeout: { after: PT1M } }
      catch: {}
  - rest: { wait: PT1S }
`);
    const run = drivenRun(document);

    expect(run.outcome).toMatchObject({ kind: 'completed' });
    expect(armedTimersAlong(run.events)).toEqual([['deadline /', 'wait /do/2/rest'], []]);
  });
});

describe('the ending a decision gives a run', () => {
  it('reads no value the run holds, whatever the input, so it can end a run whose values cannot be read', () => {
    const endings = inputs.map((input) =>
      deciding(testMachine, nothing, (options) => endingEvent(watched, options, input, gone)),
    );

    expect(endings.map(({ event }) => event.outputs.at(-1)?.kind)).toEqual(inputs.map(() => 'settle'));
    expect(() =>
      deciding(testMachine, nothing, (options) => decided(options, { ...started, at: at + 1 }, watched)),
    ).toThrow('The value 1 was read');
  });

  it('ends a run whose every value is kept and lost, reading none, in an event of the format the run reached', () => {
    const endings = inputs.map((input) =>
      deciding(testMachine, { ...nothing, contents: allMissing, format: 12 }, (options) =>
        decided(options, input, keptEverywhere),
      ),
    );

    expect(endings.map(({ events }) => events.map(({ format }) => format))).toEqual(inputs.map(() => [12]));
    expect(endings.map(({ payloads }) => payloads)).toEqual(inputs.map(() => []));
    expect(endings.map((ending) => settledAs(ending))).toEqual(inputs.map(() => ['rejected']));
  });
});
