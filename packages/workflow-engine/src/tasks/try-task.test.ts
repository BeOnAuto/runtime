import { describe, expect, it } from 'vitest';

import { armedTimersAlong, drivenRun, timersArmedIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const busy = "{ raise: { error: { type: https://example.com/busy, status: 503, detail: '${ $data.why }' } } }";

function retrying(retry: string, catchMore = ''): ReturnType<typeof workflow> {
  return workflow(`
do:
  - guarded:
      try:
        - fail: ${busy}
      catch:
        errors: { with: { status: 503 } }
        retry: ${retry}${catchMore}
`);
}

function delaysOf(run: ReturnType<typeof drivenRun>): readonly number[] {
  const dues = timersArmedIn(run.events, 'retry_delay').map(({ dueAt }) => dueAt);
  return dues.map((dueAt, index) => dueAt - (dues[index - 1] ?? run.ended.startedAt));
}

describe('a try task', () => {
  it('runs the recovery with the error it caught under the name it gives', () => {
    const document = workflow(`
do:
  - guarded:
      try:
        - fail: ${busy}
      catch:
        as: problem
        do:
          - note: { set: { status: '\${ $problem.status }', detail: '\${ $problem.detail }' } }
`);

    expect(drivenRun(document, { input: { why: 'full' } }).outcome).toEqual({
      kind: 'completed',
      output: { status: 503, detail: 'full' },
    });
  });

  it('goes on with its input when it catches an error and has no recovery', () => {
    const document = workflow(`do:\n  - guarded: { try: [{ fail: ${busy} }], catch: {} }`);

    expect(drivenRun(document, { input: { why: 'x' } }).outcome).toEqual({ kind: 'completed', output: { why: 'x' } });
  });

  it.each([
    ['errors it does not filter for', "errors: { with: { status: 404, details: 'x' } }"],
    ['errors its condition refuses', "when: '${ $error.status == 404 }'"],
    ['errors its exception takes', "exceptWhen: '${ $error.status == 503 }'"],
  ])('raises %s again', (_what, filter) => {
    const document = workflow(`
do:
  - guarded:
      try:
        - fail: ${busy}
      catch:
        ${filter}
`);

    expect(drivenRun(document, { input: { why: 'x' } }).outcome).toMatchObject({
      kind: 'raised',
      error: { type: 'https://example.com/busy' },
    });
  });
});

describe('a try task that filters and waits', () => {
  it('catches what its condition takes and its exception does not', () => {
    const document = workflow(`
do:
  - guarded:
      try:
        - fail: ${busy}
      catch:
        errors: { with: { details: x } }
        when: '\${ $error.status == 503 }'
        exceptWhen: '\${ $error.status == 404 }'
`);

    expect(drivenRun(document, { input: { why: 'x' } }).outcome).toEqual({ kind: 'completed', output: { why: 'x' } });
  });

  it('waits inside its attempt and inside its recovery', () => {
    const document = workflow(`
do:
  - guarded:
      try:
        - pause: { wait: PT1S }
        - fail: ${busy}
      catch:
        do:
          - rest: { wait: PT1S }
          - note: { set: { recovered: true } }
`);

    expect(drivenRun(document, { input: { why: 'x' } }).outcome).toEqual({
      kind: 'completed',
      output: { recovered: true },
    });
  });
});

describe('the retries of a try task', () => {
  it('try again after each delay until the attempts run out, then catch the error', () => {
    const run = drivenRun(retrying('{ delay: PT1S, limit: { attempt: { count: 3 } } }'), { input: { why: 'x' } });

    expect(delaysOf(run)).toEqual([1000, 1000, 1000]);
    expect(run.outcome).toEqual({ kind: 'completed', output: { why: 'x' } });
  });

  it.each([
    ['exponential', '{ exponential: {} }', [1000, 2000, 4000]],
    ['linear', '{ linear: {} }', [1000, 2000, 3000]],
    ['constant', '{ constant: {} }', [1000, 1000, 1000]],
  ] as const)('back off %s', (_name, backoff, delays) => {
    const run = drivenRun(retrying(`{ delay: PT1S, backoff: ${backoff}, limit: { attempt: { count: 3 } } }`), {
      input: { why: 'x' },
    });

    expect(delaysOf(run)).toEqual(delays);
  });
});

describe('the delays of the retries of a try task', () => {
  it('add a jitter drawn from the seed of the run, the same on every replay', () => {
    const policy = '{ jitter: { from: PT1S, to: PT3S }, limit: { attempt: { count: 2 } } }';
    const first = drivenRun(retrying(policy), { input: { why: 'x' }, seed: 11 });
    const again = drivenRun(retrying(policy), { input: { why: 'x' }, seed: 11 });

    expect(delaysOf(first)).toEqual(delaysOf(again));
    expect(Math.min(...delaysOf(first))).toBeGreaterThanOrEqual(1000);
    expect(Math.max(...delaysOf(first))).toBeLessThanOrEqual(3000);
  });

  it('draw a jitter from zero, or up to zero, when a bound is left out', () => {
    const fromZero = drivenRun(retrying('{ jitter: { to: PT0S }, limit: { attempt: { count: 1 } } }'), {
      input: { why: 'x' },
    });
    const toZero = drivenRun(retrying('{ jitter: { from: PT2S }, limit: { attempt: { count: 1 } } }'), {
      input: { why: 'x' },
    });

    expect([...delaysOf(fromZero), ...delaysOf(toZero)]).toEqual([0, 2000]);
  });

  it('stop once the retries have run for the duration they may take', () => {
    const run = drivenRun(retrying('{ delay: PT1S, limit: { duration: PT2S } }'), { input: { why: 'x' } });

    expect(delaysOf(run)).toEqual([1000, 1000]);
  });
});

describe('the limits of the retries of a try task', () => {
  it('limit each attempt to its duration, and try again when it runs out', () => {
    const document = workflow(`
do:
  - guarded:
      try:
        - pause: { wait: PT1H }
      catch:
        errors: { with: { status: 408 } }
        retry: { delay: PT1S, limit: { attempt: { count: 1, duration: PT10S } } }
`);
    const run = drivenRun(document);

    expect(run.outcome).toEqual({ kind: 'completed', output: {} });
    expect(run.driver.clock.now() - run.ended.startedAt).toBe(21_000);
    expect(timersArmedIn(run.events, 'attempt_limit')).toHaveLength(2);
  });

  it('use a retry policy the document names under use.retries', () => {
    const document = workflow(`
use:
  retries:
    twice: { delay: PT2S, limit: { attempt: { count: 2 } } }
do:
  - guarded:
      try:
        - fail: ${busy}
      catch:
        retry: twice
`);

    expect(delaysOf(drivenRun(document, { input: { why: 'x' } }))).toEqual([2000, 2000]);
  });
});

describe('the conditions of the retries of a try task', () => {
  it('raise a configuration error for a retry policy the document does not name', () => {
    const run = drivenRun(retrying('missing'), { input: { why: 'x' } });

    expect(run.outcome).toMatchObject({
      kind: 'raised',
      error: { status: 400, title: 'use.retries has no retry policy missing' },
    });
  });

  it('stop retrying when the condition of the policy no longer holds', () => {
    const run = drivenRun(
      retrying('{ delay: PT1S, when: \'${ $data.why == "y" }\', limit: { attempt: { count: 3 } } }'),
      {
        input: { why: 'x' },
      },
    );

    expect(delaysOf(run)).toEqual([]);
  });

  it('stop retrying when the exception of the policy holds', () => {
    const run = drivenRun(
      retrying('{ delay: PT1S, exceptWhen: \'${ $data.why == "x" }\', limit: { attempt: { count: 3 } } }'),
      { input: { why: 'x' } },
    );

    expect(delaysOf(run)).toEqual([]);
  });
});

describe('a try task that is cancelled', () => {
  it.each([
    [
      'while it backs off',
      `try: [{ fail: ${busy} }]\n        catch: { retry: { delay: PT1H, limit: { attempt: { count: 1 } } } }`,
    ],
    ['while it tries', 'try: [{ pause: { wait: PT1H } }]\n        catch: {}'],
    ['while it recovers', `try: [{ fail: ${busy} }]\n        catch: { do: [{ rest: { wait: PT1H } }] }`],
  ])('%s cancels what it waits for', (_when, body) => {
    const document = workflow(`
do:
  - both:
      fork:
        branches:
          - guarded:
              timeout: { after: PT1M }
              ${body.replaceAll('\n        ', '\n              ')}
`);
    const run = drivenRun(document, { input: { why: 'x' } });

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 408 } });
    expect(run.ended.timers.armed).toEqual({});
  });
});

describe('a try task that waits', () => {
  it('is not woken, in any phase, by a timer that is not its own', () => {
    const document = workflow(`
do:
  - all:
      fork:
        branches:
          - trying:
              try: [{ pause: { wait: PT1H } }]
              catch: {}
          - backing:
              try: [{ fail: ${busy} }]
              catch: { retry: { delay: PT1H, limit: { attempt: { count: 1 } } } }
          - recovering:
              try: [{ fail: ${busy} }]
              catch: { do: [{ rest: { wait: PT1H } }] }
          - tick: { wait: PT1S }
`);

    expect(drivenRun(document, { input: { why: 'x' } }).outcome).toMatchObject({ kind: 'completed' });
  });
});

describe('the attempt limit of a try task', () => {
  it('is disarmed once the attempt ends, whether it finished at once, after a wait, or raised', () => {
    const limit = '{ retry: { delay: PT1S, limit: { attempt: { count: 0, duration: PT10S } } } }';
    const document = workflow(`
do:
  - quick:
      try: [{ done: { set: { quick: true } } }]
      catch: ${limit}
  - slow:
      try: [{ pause: { wait: PT1S } }]
      catch: ${limit}
  - failing:
      try: [{ fail: { raise: { error: { type: x, status: 400 } } } }]
      catch: ${limit}
  - rest: { wait: PT1M }
`);

    expect(armedTimersAlong(drivenRun(document).events)).toEqual([
      ['attempt_limit /do/1/slow', 'deadline /', 'wait /do/1/slow/try/0/pause'],
      ['deadline /', 'wait /do/3/rest'],
      [],
    ]);
  });
});
