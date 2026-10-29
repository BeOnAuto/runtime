import type { CallResult } from '@on.auto/operations';
import type { JsonObject, RunOutcome } from '@on.auto/workflow-engine';
import { memoryDriver, type MemoryDriver, type Responder } from '@on.auto/workflow-engine/testing';

import {
  isArgumentsProblem,
  definitionArgumentsOf,
  type DefinitionArguments,
} from '../document/definition-arguments.ts';
import { testSandbox, testWorkflowSettings } from '../testing/test-sandbox.ts';
import { workflow } from '../testing/workflows.ts';
import {
  admittedOnTheThirdTry,
  fewerThanOneSeat,
  flakyTwice,
  refusedSeats,
  refusingSeats,
  summarizing,
} from './input-log-answers.ts';
import type { InputLog } from './input-log-corpus.ts';

type Answer = (definition: DefinitionArguments, run: number) => CallResult;

export interface InputLogPath {
  readonly name: string;
  readonly source: string;
  readonly ends: RunOutcome;
  readonly input?: JsonObject;
  readonly answer?: Answer;
  readonly meanwhile?: (driver: MemoryDriver, runId: string) => void;
}

function attributesOf(name: string, runId: string): JsonObject {
  return {
    org: 'acme',
    playbook: 'alpha',
    run_id: runId,
    definition: { name, version: 1 },
    caller: { id: 'acme-admin' },
  };
}

function delivering(...events: readonly { readonly id: string; readonly type: string; readonly data: string }[]) {
  return (driver: MemoryDriver, runId: string): void => {
    for (const event of events) {
      driver.deliver(runId, event);
    }
  };
}

function cancellingAfter(milliseconds: number) {
  return (driver: MemoryDriver, runId: string): void => {
    driver.at(milliseconds, () => {
      driver.cancel(runId);
    });
  };
}

export const inputLogPaths: readonly InputLogPath[] = [
  {
    name: 'cancelled',
    source: 'do:\n  - pause: { wait: PT1H }',
    ends: { kind: 'cancelled', cancel: { by: 'tester', kind: 'requested', reason: 'The test cancelled the run' } },
    meanwhile: cancellingAfter(10),
  },
  {
    name: 'catch-do-recovery',
    source: `
do:
  - guarded:
      try:
        - fail: { raise: { error: { type: https://example.com/errors/busy, status: 503 } } }
      catch:
        errors: { with: { status: 503 } }
        do:
          - recover: { set: { recovered: true } }
`,
    ends: { kind: 'completed', output: { recovered: true } },
  },
  {
    name: 'run-definition',
    source: `
do:
  - summarize:
      call: run_definition
      with: { type: reasoning, name: summarize, input: { text: '\${ $data.text }' } }
  - answer:
      set: { summary: '\${ $data.summary }', runtime: '\${ $runtime.name }' }
`,
    input: { text: 'hello' },
    ends: { kind: 'completed', output: { summary: 'summarize of {"text":"hello"}', runtime: 'auto-runtime' } },
    answer: summarizing,
  },
  {
    name: 'for-with-wait',
    source: `
do:
  - each:
      for: { in: '\${ [1, 2] }' }
      do:
        - pause: { wait: { milliseconds: 200 } }
        - add: { set: { total: '\${ ($data.total ?? 0) + $item }' } }
`,
    ends: { kind: 'completed', output: { total: 3 } },
  },
  {
    name: 'fork-compete',
    source: `
do:
  - race:
      fork:
        compete: true
        branches:
          - slow: { do: [{ pause: { wait: PT5S } }, { done: { set: { won: slow } } }] }
          - quick: { set: { won: quick } }
`,
    ends: { kind: 'completed', output: { won: 'quick' } },
  },
  {
    name: 'listen-signals',
    source: 'do:\n  - await: { listen: { to: { one: { with: { type: approved } } } } }',
    ends: { kind: 'completed', output: ['yes'] },
    meanwhile: delivering({ id: 'e1', type: 'declined', data: 'no' }, { id: 'e2', type: 'approved', data: 'yes' }),
  },
  {
    name: 'parallel-fork',
    source: `
do:
  - both:
      fork:
        branches:
          - left: { call: run_definition, with: { type: reasoning, name: left } }
          - right: { call: run_definition, with: { type: reasoning, name: right } }
`,
    ends: { kind: 'completed', output: [{ summary: 'left of {}' }, { summary: 'right of {}' }] },
    answer: summarizing,
  },
  {
    name: 'retry-with-backoff',
    source: `
do:
  - guarded:
      try:
        - fetch: { call: run_definition, with: { type: reasoning, name: flaky, input: { key: backoff } } }
      catch:
        errors: { with: { status: 503 } }
        retry: { delay: { milliseconds: 500 }, backoff: { exponential: {} }, limit: { attempt: { count: 3 } } }
`,
    ends: { kind: 'completed', output: { calls: 3 } },
    answer: flakyTwice,
  },
  {
    name: 'switch',
    source: `
do:
  - decide:
      switch:
        - big: { when: '\${ false }', then: large }
        - otherwise: { then: small }
  - large: { set: { size: large }, then: end }
  - small: { set: { size: small } }
`,
    ends: { kind: 'completed', output: { size: 'small' } },
  },
  {
    name: 'temporal-global',
    source: `
do:
  - clock:
      set:
        startedAt: '\${ $workflow.startedAt.iso8601 }'
        taskStartedAt: '\${ $task.startedAt.epoch.milliseconds }'
        now: '\${ Date.now() }'
`,
    ends: {
      kind: 'completed',
      output: { startedAt: '2026-10-01T09:00:00.000Z', taskStartedAt: 1_790_845_200_000, now: 1_790_845_200_000 },
    },
  },
  {
    name: 'then-jump-back',
    source: `
do:
  - count: { set: { n: '\${ ($data.n ?? 0) + 1 }' } }
  - again: { if: '\${ $data.n < 3 }', wait: { milliseconds: 100 }, then: count }
`,
    ends: { kind: 'completed', output: { n: 3 } },
  },
  {
    name: 'timeout-fires',
    source: `
do:
  - guarded:
      try:
        - slow: { wait: PT5S, timeout: { after: { milliseconds: 300 } } }
      catch:
        errors: { with: { status: 408 } }
        do:
          - late: { set: { timedOut: true } }
`,
    ends: { kind: 'completed', output: { timedOut: true } },
  },
  {
    name: 'timer',
    source: 'do:\n  - pause: { wait: { milliseconds: 1200 } }',
    input: { waited: true },
    ends: { kind: 'completed', output: { waited: true } },
  },
  {
    name: 'uncaught-error',
    source: 'do:\n  - reject: { raise: { error: { type: https://example.com/no, status: 422, title: No } } }',
    ends: {
      kind: 'raised',
      error: { type: 'https://example.com/no', status: 422, title: 'No', instance: '/do/0/reject' },
    },
  },
  {
    name: 'worker-restart',
    source: `
do:
  - first: { set: { step: first } }
  - pause: { wait: PT2S }
  - last: { set: { step: '\${ $data.step + ", then last" }' } }
`,
    ends: { kind: 'completed', output: { step: 'first, then last' } },
  },
  {
    name: 'refused-input',
    source: `
do:
  - race:
      fork:
        compete: true
        branches:
          - first: { call: run_definition, with: { type: computation, name: hold-seats, input: { seats: 0 } } }
          - later: { do: [{ pause: { wait: { milliseconds: 200 } } }, { again: { call: run_definition, with: { type: computation, name: hold-seats } } }] }
`,
    ends: {
      kind: 'raised',
      error: {
        type: 'https://open-workflow-specification.org/spec/1.0.0/errors/validation',
        status: 400,
        instance: '/do/0/race/fork/branches/0/first',
        title: 'The computation function hold-seats refused its input',
        detail: fewerThanOneSeat,
        issues: refusedSeats,
      },
    },
    answer: refusingSeats,
  },
  {
    name: 'admission-wait',
    source: `
do:
  - first: { call: run_definition, with: { type: reasoning, name: summarize, input: { text: hello } } }
  - second: { call: run_definition, with: { type: reasoning, name: tally } }
`,
    ends: { kind: 'completed', output: { summary: 'tally of {}' } },
    answer: admittedOnTheThirdTry,
  },
];

export function responderOf(answer: Answer): Responder {
  return (call) => {
    const definition = definitionArgumentsOf(call.arguments);
    if (isArgumentsProblem(definition)) {
      return { result: { status: 'rejected', reason: 'invalid_arguments', detail: definition.title } };
    }
    return { after: 50, result: answer(definition, call.key.run) };
  };
}

export function inputLogOf(name: string): InputLog {
  const number = inputLogPaths.findIndex((path) => path.name === name);
  const path = inputLogPaths[number];
  if (path === undefined) {
    throw new Error(`No input log path is named ${name}`);
  }
  const runId = `0199a3c4-7d2e-7c1a-9b3f-${String(300 + number).padStart(12, '0')}`;
  const driver = memoryDriver({
    sandbox: testSandbox,
    machine: testWorkflowSettings,
    respond: responderOf(path.answer ?? summarizing),
  });
  driver.start({
    runId,
    document: workflow(path.source),
    input: path.input ?? {},
    attributes: attributesOf(path.name, runId),
  });
  path.meanwhile?.(driver, runId);
  driver.runUntilEnded(runId);
  return {
    name: path.name,
    inputs: driver.inputsOf(runId),
    events: driver.ports.runStore.events(runId).map(({ event }) => event),
  };
}
