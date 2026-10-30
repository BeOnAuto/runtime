import type { CallResult } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import type { StartCall } from '../dispatch/run-output.ts';
import { errorType } from '../dsl/raised-error.ts';
import { mostCallArgumentsBytes } from '../machine/limits.ts';
import type { Responder } from '../memory/memory-executor.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';
import { drivenRunId, drivenRun, outputKindsIn, outputsIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const calling = workflow(
  "do:\n  - ask: { call: notify, with: { to: '${ $data.name }' } }\n  - after: { set: { answer: '${ $data }' } }",
);

const firstAsk = { runId: drivenRunId, reference: '/do/0/ask', run: 1 };

function answeredWith(result: CallResult) {
  return drivenRun(calling, { input: { name: 'ada' }, respond: () => ({ after: 10, result }) });
}

function startsIn(run: ReturnType<typeof drivenRun>): readonly StartCall[] {
  return outputsIn(run.events).filter((output): output is StartCall => output.kind === 'start_call');
}

function raisedBy(kind: Parameters<typeof errorType>[0], status: number, title: string, detail: string) {
  return { kind: 'raised', error: { type: errorType(kind), status, title, detail, instance: '/do/0/ask' } };
}

function answeringOnlyTheSecondRun(record: (entry: string) => void): Responder {
  return (call) => {
    record(`${call.key.run}`);
    return call.key.run === 1 ? 'never' : { after: 10, result: { status: 'succeeded', output: 'second' } };
  };
}

function answeringTheFirstRunLate(record: (entry: string) => void) {
  return (driver: MemoryDriver, runId: string): void => {
    driver.at(1500, () => {
      const key = { runId, reference: '/do/0/guarded/try/0/ask', run: 1 };
      const result = { status: 'succeeded', output: 'first' } as const;
      record(driver.submit({ kind: 'call_answered', runId, at: driver.clock.now(), key, result }).outcome);
    });
  };
}

describe('a call task', () => {
  it('starts a call with its key, its function, its evaluated arguments and the longest it may run', () => {
    const run = answeredWith({ status: 'succeeded', output: 'sent' });
    const start = {
      kind: 'start_call',
      key: firstAsk,
      function: 'notify',
      arguments: { to: 'ada' },
      longestMs: 600_000,
    };

    expect(startsIn(run)).toEqual([start]);
    expect(run.outcome).toEqual({ kind: 'completed', output: { answer: 'sent' } });
  });

  it.each([
    ['invalid_input', 'validation', 400, 'refused its input'],
    ['forbidden', 'authorization', 403, 'was not allowed'],
    ['not_found', 'configuration', 404, 'could not be found'],
    ['conflict', 'runtime', 409, 'could not go through'],
    ['unavailable', 'communication', 503, 'was not available'],
  ] as const)(
    'raises a rejection for %s as a %s error, status %d, titled in plain words',
    (reason, kind, status, refused) => {
      expect(answeredWith({ status: 'rejected', reason, detail: 'no' }).outcome).toEqual(
        raisedBy(kind, status, `The function notify ${refused}`, 'no'),
      );
    },
  );

  it('raises a failure as a runtime error, status 500, and an unreachable call as a communication error, status 503', () => {
    expect(answeredWith({ status: 'failed', detail: 'it broke' }).outcome).toEqual(
      raisedBy('runtime', 500, 'The function notify failed', 'it broke'),
    );
    expect(answeredWith({ status: 'unreachable', detail: 'gone' }).outcome).toEqual(
      raisedBy('communication', 503, 'notify could not reach the function notify', 'gone'),
    );
  });
});

describe('the arguments of a call', () => {
  it('raise a validation error that carries its detail when the executor refuses them', () => {
    const refused = answeredWith({ status: 'rejected', reason: 'invalid_arguments', detail: 'notify needs a to' });

    expect(refused.outcome).toEqual({
      kind: 'raised',
      error: { type: errorType('validation'), status: 400, title: 'notify needs a to', instance: '/do/0/ask' },
    });
  });

  it('raise a validation error, and start nothing, when they are larger than a call takes', () => {
    const run = drivenRun(calling, { input: { name: 'x'.repeat(mostCallArgumentsBytes) } });
    const title = `The arguments of notify take ${mostCallArgumentsBytes + 9} bytes as JSON, more than the ${mostCallArgumentsBytes} a call takes`;

    expect(startsIn(run)).toEqual([]);
    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 400, title } });
  });
});

describe('an answer that comes too late', () => {
  it('is stale once the task timed out and cancelled its call, and appends nothing', () => {
    const document = workflow('do:\n  - ask: { call: notify, with: { to: ada }, timeout: { after: PT1S } }');
    const run = drivenRun(document, { respond: () => 'never' });
    const before = run.events.length;
    const result = { status: 'succeeded', output: 'late' } as const;

    const late = run.driver.submit({
      kind: 'call_answered',
      runId: drivenRunId,
      at: 0,
      key: firstAsk,
      result,
    });

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 408 } });
    expect(outputKindsIn(run.events)).toContain('cancel_call');
    expect(late).toEqual({ outcome: 'stale', version: before });
    expect(run.driver.ports.runStore.events(drivenRunId)).toHaveLength(before);
  });

  it('is stale when it answers an earlier attempt of a retried call, and the attempt that runs takes its own', () => {
    const document = workflow(`
do:
  - guarded:
      try:
        - ask: { call: notify, with: { to: ada }, timeout: { after: PT1S } }
      catch:
        errors: { with: { status: 408 } }
        retry: { delay: PT1S, limit: { attempt: { count: 1 } } }
`);
    const seen: string[] = [];
    const record = (entry: string): void => {
      seen.push(entry);
    };
    const run = drivenRun(document, {
      respond: answeringOnlyTheSecondRun(record),
      meanwhile: answeringTheFirstRunLate(record),
    });

    expect(seen).toEqual(['1', 'stale', '2']);
    expect(run.outcome).toEqual({ kind: 'completed', output: 'second' });
  });
});

describe('calls that run at once', () => {
  it('each take their own answer, whichever answer comes first', () => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - left: { call: notify, with: { to: left } }
          - right: { call: notify, with: { to: right } }
`);
    const run = drivenRun(document, {
      respond: (call) => ({
        after: call.key.reference.length,
        result: { status: 'succeeded', output: call.arguments },
      }),
    });

    expect(run.outcome).toEqual({ kind: 'completed', output: [{ to: 'left' }, { to: 'right' }] });
  });
});
