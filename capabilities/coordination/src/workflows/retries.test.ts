import { describe, expect, it } from 'vitest';

import type { Command } from '../testing/machine-host.ts';
import type { DefinitionCall, DefinitionCallResult } from '../testing/run-terms.ts';
import { callsIn, interpret, neverAnswers, workflow } from '../testing/workflows.ts';

function retrying(retry: string, extra = ''): ReturnType<typeof workflow> {
  return workflow(`
${extra}
do:
  - guarded:
      try:
        - fetch:
            call: run_definition
            with: { type: reasoning, name: lookup, input: {} }
      catch:
        errors: { with: { status: 503 } }
        retry: ${retry}
        do: [{ gave_up: { set: { gave_up: true } } }]
`);
}

function failingTimes(times: number): (call: DefinitionCall) => DefinitionCallResult {
  return ({ run }) =>
    run <= times
      ? { status: 'rejected', reason: 'unavailable', detail: 'busy' }
      : { status: 'succeeded', output: { run } };
}

function delaysIn(commands: readonly Command[]): readonly number[] {
  return commands.flatMap((command) => (command.kind === 'timer' ? [command.milliseconds] : []));
}

describe('a retry policy', () => {
  it('runs the try again after the delay, with a new run of each task, until it succeeds', async () => {
    const { ending, commands } = await interpret(retrying('{ delay: PT2S }'), { respond: failingTimes(2) });

    expect(ending).toEqual({ kind: 'completed', output: { run: 3 } });
    expect(callsIn(commands).map(({ run }) => run)).toEqual([1, 2, 3]);
    expect(delaysIn(commands)).toEqual([2000, 2000]);
  });

  it('runs catch.do when its attempts run out', async () => {
    const { ending, commands } = await interpret(retrying('{ delay: PT1S, limit: { attempt: { count: 2 } } }'), {
      respond: failingTimes(5),
    });

    expect(ending).toEqual({ kind: 'completed', output: { gave_up: true } });
    expect(callsIn(commands)).toHaveLength(3);
  });

  it('is reused by name from use.retries', async () => {
    const { commands } = await interpret(
      retrying('patient', 'use:\n  retries:\n    patient: { delay: PT3S, limit: { attempt: { count: 1 } } }'),
      { respond: failingTimes(5) },
    );

    expect(delaysIn(commands)).toEqual([3000]);
  });
});

describe('the backoff of a retry policy', () => {
  it('doubles the delay when exponential', async () => {
    const { commands } = await interpret(
      retrying('{ delay: PT1S, backoff: { exponential: {} }, limit: { attempt: { count: 3 } } }'),
      { respond: failingTimes(5) },
    );

    expect(delaysIn(commands)).toEqual([1000, 2000, 4000]);
  });

  it('grows the delay by itself when linear, and keeps it when constant', async () => {
    const linear = await interpret(
      retrying('{ delay: PT1S, backoff: { linear: {} }, limit: { attempt: { count: 3 } } }'),
      { respond: failingTimes(5) },
    );
    const constant = await interpret(
      retrying('{ delay: PT1S, backoff: { constant: {} }, limit: { attempt: { count: 2 } } }'),
      { respond: failingTimes(5) },
    );

    expect(delaysIn(linear.commands)).toEqual([1000, 2000, 3000]);
    expect(delaysIn(constant.commands)).toEqual([1000, 1000]);
  });
});

describe('the limits of a retry policy', () => {
  it('stops retrying once the total duration has passed', async () => {
    const { commands } = await interpret(retrying('{ delay: PT10S, limit: { duration: PT25S } }'), {
      respond: failingTimes(10),
    });

    expect(delaysIn(commands)).toEqual([10_000, 10_000, 10_000]);
  });

  it('gives each attempt at most its duration', async () => {
    const document = workflow(`
do:
  - guarded:
      try: [{ fetch: { call: run_definition, with: { type: reasoning, name: lookup } } }]
      catch:
        retry: { delay: PT1S, limit: { attempt: { count: 1, duration: PT5S } } }
        do: [{ gave_up: { set: '\${ $error.status }' } }]
`);

    const { ending, commands } = await interpret(document, { respond: neverAnswers });

    expect(ending).toEqual({ kind: 'completed', output: 408 });
    expect(commands).toContainEqual({ kind: 'cancelled', summary: '/do/0/guarded/try/0/fetch' });
  });
});

describe('the conditions of a retry policy', () => {
  it('retries only when its when holds and its exceptWhen does not', async () => {
    const retried = await interpret(
      retrying(
        "{ delay: PT1S, when: '$error.status == 503', exceptWhen: '$error.detail == \"never\"', limit: { attempt: { count: 1 } } }",
      ),
      { respond: failingTimes(5) },
    );
    const notRetried = await interpret(retrying("{ delay: PT1S, exceptWhen: '$error.status == 503' }"), {
      respond: failingTimes(5),
    });

    expect(delaysIn(retried.commands)).toEqual([1000]);
    expect(delaysIn(notRetried.commands)).toEqual([]);
    expect(notRetried.ending).toEqual({ kind: 'completed', output: { gave_up: true } });
  });

  it('raises a configuration error when it names a policy use.retries lacks', async () => {
    expect((await interpret(retrying('nowhere'), { respond: failingTimes(5) })).settlement).toMatchObject({
      detail: 'use.retries has no retry policy nowhere, at the step guarded.',
    });
  });
});
