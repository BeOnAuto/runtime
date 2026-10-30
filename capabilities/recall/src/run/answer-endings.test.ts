import { Conflict, Unavailable } from '@on.auto/operations';
import type { PoolOutcome, ProgramPool, ProgramRequest } from '@on.auto/workflow-engine/dsl';
import { scriptedPool } from '@on.auto/workflow-engine/testing';
import { Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignReviews, foldOf, recallDocument } from '../testing/campaign-reviews.ts';
import { liveView, poolOf, recallWith, type AnswerBounds } from '../testing/recall-runs.ts';

const succeeded = 'language: typescript\nsource:\n  events:\n    - type: run_succeeded';

function unworkable(detail: string): Exit.Exit<never, Conflict> {
  return Exit.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function answering(answer: string, more = ''): string {
  return recallDocument(foldOf('return view;', answer), `${succeeded}${more}`);
}

const springWithoutReviews = { spring: [] };

const noInput = {};

function ended(source: string, view: Schema.Json = springWithoutReviews, input: Schema.Json = noInput) {
  const run = recallWith();
  run.keep(liveView(view));
  return run.running(source, input);
}

function endedWithin(bounds: AnswerBounds, source: string) {
  const run = recallWith(poolOf(), bounds);
  run.keep(liveView(springWithoutReviews));
  return run.running(source, noInput);
}

function usedAfter(checkpoints: number, mebibytes: number): Exit.Exit<never, Conflict> {
  return unworkable(
    `The answer used more memory than a run may, the ${mebibytes} MiB of its sandbox, having done ${checkpoints} checkpoints of work`,
  );
}

function reaching(limit: 'work' | 'memory'): PoolOutcome {
  return {
    ran: 'exhausted',
    limit,
    issue: { detail: 'The answer reached a bound', line: null },
    work: 7,
    milliseconds: 5,
  };
}

interface RecordingPool {
  readonly pool: ProgramPool;
  readonly asked: () => readonly (readonly [number, number])[];
}

function recordingPool(script: readonly PoolOutcome[]): RecordingPool {
  const scripted = scriptedPool(script, poolOf());
  const asked: ProgramRequest[] = [];
  return {
    pool: {
      ...scripted,
      run: (request, signal) => {
        asked.push(request);
        return scripted.run(request, signal);
      },
    },
    asked: () => asked.map(({ budget, memoryBytes }) => [budget, memoryBytes]),
  };
}

const stoppedWhen: readonly (readonly [PoolOutcome, string])[] = [
  [
    { ran: 'stopped', because: 'busy', milliseconds: 10_000 },
    'No worker was free to answer within 10000 ms; this server runs 2 programs at once',
  ],
  [
    { ran: 'stopped', because: 'memory', milliseconds: 10 },
    "The answer's worker took more than the 256 MiB of heap it may use, and was stopped",
  ],
  [
    { ran: 'stopped', because: 'deadline', milliseconds: 10_000 },
    'The answer took longer than the 10000 ms a recall function may run, and was stopped',
  ],
  [{ ran: 'stopped', because: 'cancelled', milliseconds: 1 }, 'The run was stopped before it ended'],
  [{ ran: 'stopped', because: 'closing', milliseconds: 1 }, 'The server is stopping'],
  [
    {
      ran: 'exhausted',
      limit: 'deadline',
      issue: { detail: 'The program ran past its deadline', line: null },
      work: 5,
      milliseconds: 10_000,
    },
    'The answer took longer than the 10000 ms a recall function may run, and was stopped',
  ],
];

const brokenWhen: readonly (readonly [PoolOutcome, string])[] = [
  [{ ran: 'crashed', detail: 'The worker failed: broken', milliseconds: 1 }, 'The worker failed: broken'],
  [
    { ran: 'refused', issue: { detail: 'The program exports no function answer', line: null }, milliseconds: 1 },
    'The worker refused an answer the definition was accepted with: The program exports no function answer',
  ],
];

describe('a run whose answer cannot work as written', () => {
  it('ends in conflict, unworkable, with the error the answer raised and its line in the document', async () => {
    expect(await ended(answering('throw new Error(`no campaign ${view.spring.length}`);'))).toEqual(
      unworkable('The answer raised an error on line 12: Error: no campaign 0'),
    );
    expect(await ended(answering('return view.autumn.length;'))).toEqual(
      unworkable("The answer raised an error on line 12: TypeError: cannot read property 'length' of undefined"),
    );
    expect(await ended(answering("throw 'no campaign';"))).toEqual(
      unworkable('The answer raised an error: no campaign'),
    );
  });

  it('ends in conflict when its answer, or the view it answers, is not what the output schema allows, checked in the worker', async () => {
    expect(await ended(campaignReviews, { spring: [1] }, { campaign: 'spring' })).toEqual(
      unworkable('The answer does not match the output schema: /0: Expected object'),
    );
    expect(
      await ended(recallDocument(foldOf('return view;'), `${succeeded}\noutput: {schema: {type: array}}`), {
        spring: [],
      }),
    ).toEqual(unworkable('The view does not match the output schema: the output: Expected array'));
    expect(
      await ended(
        recallDocument(
          foldOf('return view;'),
          `${succeeded}\noutput: {schema: {properties: {spring: {type: string}}}}`,
        ),
      ),
    ).toEqual(unworkable('The view does not match the output schema: /spring: Expected string'));
    expect(await ended(answering('return [view.spring];', '\noutput: {schema: {type: object}}'))).toEqual(
      unworkable('The answer does not match the output schema: the output: Expected object'),
    );
  });

  it('ends in conflict when its answer is not JSON, or takes more than a run can record beside its record', async () => {
    expect(await ended(answering('return 0 / 0;'))).toEqual(
      unworkable('The answer is not JSON: The answer holds NaN at $, which JSON cannot carry'),
    );
    expect(await ended(answering('return "x".repeat(1100000);'))).toEqual(
      unworkable('The answer takes more than the 1046528 bytes as JSON a run can record'),
    );
  });
});

describe('a run whose answer reaches a bound', () => {
  it('ends in conflict when it does more work than its budget before any deadline, or uses more memory than its sandbox', async () => {
    expect(await endedWithin({ budget: 50 }, answering('for (;;) {}'))).toEqual(
      unworkable('The answer did more work than a run may, 50 checkpoints, and was stopped'),
    );
    expect(
      await endedWithin(
        { memoryBytes: 16_777_216 },
        answering('const kept: string[] = [];\n  for (;;) kept.push("y".repeat(1048576) + kept.length);'),
      ),
    ).toEqual(usedAfter(0, 16));
  });

  it('ends in conflict when the stack of its worker overflows before its own', async () => {
    const overflowing: PoolOutcome = {
      ran: 'exhausted',
      limit: 'stack',
      issue: { detail: 'The program went deeper than the stack it runs on allows', line: null },
      work: 10,
      milliseconds: 5,
    };
    const run = recallWith(scriptedPool([overflowing], poolOf()));
    run.keep(liveView({}));

    expect(await run.running(answering('return view;'))).toEqual(
      unworkable('The answer went deeper than the 1 MiB stack of a run allows'),
    );
    expect(await run.running(answering('return view;'))).toMatchObject(Exit.succeed({ output: {} }));
  });
});

describe('the bounds an answer asks its sandbox for', () => {
  it('are those its host gives, or 500 checkpoints and 256 MiB, named when the answer reaches them', async () => {
    const byDefault = recordingPool([reaching('work'), reaching('memory')]);
    const given = recordingPool([reaching('work'), reaching('memory')]);
    const runs = recallWith(byDefault.pool);
    const smallRuns = recallWith(given.pool, { budget: 40, memoryBytes: 33_554_432 });
    runs.keep(liveView({}));
    smallRuns.keep(liveView({}));

    expect([await runs.running(answering('return view;')), await runs.running(answering('return view;'))]).toEqual([
      unworkable('The answer did more work than a run may, 500 checkpoints, and was stopped'),
      usedAfter(7, 256),
    ]);
    expect([
      await smallRuns.running(answering('return view;')),
      await smallRuns.running(answering('return view;')),
    ]).toEqual([
      unworkable('The answer did more work than a run may, 40 checkpoints, and was stopped'),
      usedAfter(7, 32),
    ]);
    expect([byDefault.asked(), given.asked()]).toEqual([
      [
        [500, 268_435_456],
        [500, 268_435_456],
      ],
      [
        [40, 33_554_432],
        [40, 33_554_432],
      ],
    ]);
  });
});

describe('a run of an answer its save did not strip', () => {
  it('ends in conflict, unworkable, rather than run the author’s TypeScript', async () => {
    const run = recallWith();
    run.keep(liveView(springWithoutReviews));

    expect(await run.runningUnsaved(answering('return view;'), noInput)).toEqual(
      unworkable(
        'The recall function was saved without the module its check strips for the sandbox; update it to save it again',
      ),
    );
  });
});

describe('a run whose answer the server cannot finish', () => {
  it('is unavailable when it runs past its deadline', async () => {
    const slow = recallWith(poolOf(), { deadlineMs: 300 });
    slow.keep(liveView({}));

    expect(
      await slow.running(answering('const big = ["x".repeat(4000000)];\n  for (;;) JSON.stringify(big);')),
    ).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'The answer took longer than the 300 ms a recall function may run, and was stopped',
        }),
      ),
    );
  });
});

describe('a run whose answer the pool stops', () => {
  it.each(stoppedWhen)('is unavailable when the pool answers %j', async (outcome, detail) => {
    const run = recallWith(scriptedPool([outcome], poolOf()));
    run.keep(liveView({}));

    expect(await run.running(answering('return view;'))).toEqual(Exit.fail(new Unavailable({ detail })));
  });

  it.each(brokenWhen)('fails, as the server breaks, when the pool answers %j', async (outcome, defect) => {
    const run = recallWith(scriptedPool([outcome], poolOf()));
    run.keep(liveView({}));
    const exit = await run.running(answering('return view;'));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(String(Exit.findDefect(exit))).toContain(defect);
  });
});
