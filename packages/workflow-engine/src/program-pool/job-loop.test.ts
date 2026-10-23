import { afterEach, describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { foldAnswerOf, foldPageData } from '../folds/fold-answer.ts';
import type { FoldPage } from '../folds/fold-page.ts';
import { foldProgress, type FoldProgress } from '../folds/fold-progress.ts';
import type { CheckJob } from '../jobs/check-messages.ts';
import { answerOf, type OutputCheck } from '../jobs/program-answer.ts';
import { handedSandbox, sourcesUnderTest, type SourceUnderTest } from '../pool-testing/test-pools.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { serveJobs, serveJobsWith } from './job-loop.ts';

type HandlersOf = Parameters<typeof serveJobsWith>[0];

type Ask = (message: unknown) => Promise<unknown>;

const noSchemaChecked: unknown = expect.stringContaining('checks no view schema');

interface FoldJobParts {
  readonly page?: Partial<FoldPage>;
  readonly events?: string;
  readonly progress?: FoldProgress;
}

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const { port1, port2 } of channels.splice(0)) {
    port1.close();
    port2.close();
  }
});

function servedWith(
  instances: SourceUnderTest['name'],
  handlersOf: HandlersOf,
  handed: Readonly<Record<string, Readonly<Uint8Array>>> = {},
): Ask {
  const { port1, port2 } = new MessageChannel();
  channels.push({ port1, port2 });
  const ready = Promise.withResolvers<unknown>();
  port2.once('message', ready.resolve);
  serveJobsWith(handlersOf, port1, { handed: { ...handedSandbox, ...handed }, instances });
  return async (message) => {
    await ready.promise;
    const { promise, resolve } = Promise.withResolvers<unknown>();
    port2.once('message', (answer: unknown) => {
      resolve(answer);
    });
    port2.postMessage(message, []);
    return promise;
  };
}

function served(instances: SourceUnderTest['name'], handlers: ReturnType<HandlersOf>): Ask {
  return servedWith(instances, () => handlers);
}

function inTurn(ask: Ask, messages: readonly unknown[]): Promise<readonly unknown[]> {
  return messages.reduce<Promise<readonly unknown[]>>(
    async (before, message) => [...(await before), await ask(message)],
    Promise.resolve([]),
  );
}

async function keptAfter(ask: Ask, messages: readonly unknown[]): Promise<readonly unknown[]> {
  return (await inTurn(ask, messages)).map((answer): unknown => Reflect.get(new Object(answer), 'keep'));
}

function program(body: string): string {
  return `export default function (input) {\n  ${body}\n}`;
}

function programJob(job: number, source: string, more: Readonly<Record<string, Json>> = {}): unknown {
  const deadlineAt = performance.timeOrigin + performance.now() + 10_000;
  const request = {
    source,
    entry: 'default',
    arguments: ['1'],
    moment: 0,
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: threadStackBytes,
    mostOutputBytes: 1000,
    deadlineAt,
    context: null,
  };
  return { job, kind: 'program', request: { ...request, ...more } };
}

const adding = 'export function fold(view, event) {\n  return view + event.data;\n}';

function foldJob(job: number, views: readonly JsonObject[], parts: FoldJobParts = {}): unknown {
  const request = foldPageData({
    events: [{ type: 'noted', data: 2 }],
    views: views.map((view) => ({ fold: adding, filters: [{ type: 'noted' }], view: 1, events: [0], ...view })),
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: threadStackBytes,
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 1000,
    ...parts.page,
  });
  const progress = parts.progress ?? foldProgress();
  return {
    job,
    kind: 'fold',
    request: { ...request, events: parts.events ?? request.events },
    progress: progress.shared,
  };
}

const checkRequest: CheckJob = { schemas: {}, expressions: [{ source: '$data', names: ['$data'] }] };

function checkJob(job: number): unknown {
  return { job, kind: 'check', request: checkRequest };
}

function refusingEvery(detail: string): OutputCheck {
  return () => [{ pointer: '', detail }];
}

describe.each(sourcesUnderTest)('a loop that starts serving jobs on $name instances', ({ name }) => {
  it('tells the pool it is ready once it listens, before any job', async () => {
    const { port1, port2 } = new MessageChannel();
    channels.push({ port1, port2 });
    const first = Promise.withResolvers<unknown>();
    port2.once('message', first.resolve);

    serveJobs({}, port1);

    expect(await first.promise).toEqual({ ready: true });
  });

  it('makes its handlers of the files the pool handed its worker', async () => {
    const note = { package: '@acme/shipped', path: 'note.txt' };
    const ask = servedWith(
      name,
      (handed) => ({
        check: () => ({ ran: 'checked', issues: [{ at: 0, line: 1, detail: new TextDecoder().decode(handed(note)) }] }),
      }),
      { '@acme/shipped/note.txt': new TextEncoder().encode('Handed at start') },
    );

    expect(await ask({ job: 1, kind: 'check', request: checkRequest })).toMatchObject({
      job: 1,
      answer: { ran: 'checked', issues: [{ detail: 'Handed at start' }] },
    });
  });
});

describe.each(sourcesUnderTest)('a loop that serves jobs on $name instances', ({ name }) => {
  it('answers each job by its id, with the answer of the handler of its kind and whether the worker may be kept', async () => {
    const ask = served(name, {
      program: answerOf,
      fold: foldAnswerOf,
      check: ({ expressions }) => ({
        ran: 'checked',
        issues: expressions.map(({ source }, at) => ({ at, line: 1, detail: source })),
      }),
    });

    expect(
      await inTurn(ask, [programJob(3, program('return input + 1;')), foldJob(4, [{}]), checkJob(5)]),
    ).toMatchObject([
      { job: 3, answer: { ran: 'answered', output: '2', bytes: 1 }, keep: true },
      { job: 4, answer: { ran: 'folded', views: [{ view: '3', folded: 1 }] }, keep: true },
      { job: 5, answer: { ran: 'checked', issues: [{ at: 0, line: 1, detail: '$data' }] }, keep: true },
    ]);
  });

  it('runs each program in a fresh instance, so nothing one job leaves reaches the next', async () => {
    const ask = served(name, { program: answerOf });

    expect(
      await inTurn(ask, [
        programJob(
          1,
          program('Reflect.set(globalThis, "seen", input);\n  return typeof Reflect.get(globalThis, "seen");'),
        ),
        programJob(2, program('return typeof Reflect.get(globalThis, "seen");')),
      ]),
    ).toMatchObject([{ answer: { output: '"number"' } }, { answer: { output: '"undefined"' } }]);
  });

  it('marks the place of each fold in the memory the envelope shares, so the pool can name the fold that was going', async () => {
    const progress = foldProgress();

    await served(name, { fold: foldAnswerOf })(foldJob(1, [{}, {}], { progress }));

    expect(progress.last()).toEqual({ event: 0, view: 1 });
  });
});

describe.each(sourcesUnderTest)('the worker of a loop that serves jobs on $name instances', ({ name }) => {
  it('is kept after every program but one its deadline ended, and after every page but one with a view past its deadline', async () => {
    const ask = served(name, { program: answerOf, fold: foldAnswerOf });
    const pastItsDeadline = { deadlineAt: performance.timeOrigin + performance.now() - 1 };
    const endless = 'export function fold(view) {\n  for (;;) {}\n}';

    expect(
      await keptAfter(ask, [
        programJob(1, program('throw new Error("stop");')),
        programJob(2, program('for (;;) {}')),
        programJob(3, program('return 0 / 0;')),
        programJob(4, program('for (;;) {}'), pastItsDeadline),
        foldJob(5, [{ fold: 'export function fold() {\n  throw new Error("stop");\n}' }]),
        foldJob(6, [{ fold: endless }, {}], { page: { foldDeadlineMs: 1 } }),
      ]),
    ).toEqual([true, true, true, false, true, false]);
  });
});

describe.each(sourcesUnderTest)('a loop given a job it cannot serve on $name instances', ({ name }) => {
  it('answers a page whose events it cannot read as unreadable, and does not keep its worker', async () => {
    expect(await served(name, { fold: foldAnswerOf })(foldJob(1, [{}], { events: '{' }))).toEqual({
      job: 1,
      answer: { ran: 'unreadable' },
      keep: false,
    });
  });

  it('answers what is not an envelope, or a kind it has no handler for, as unreadable, naming the job when it can', async () => {
    const programs = served(name, { program: answerOf });
    const folds = served(name, { fold: foldAnswerOf });

    expect([
      ...(await inTurn(programs, [{ nonsense: true }, { job: 8, kind: 'program' }, foldJob(9, [{}]), checkJob(10)])),
      await folds(programJob(11, program('return input;'))),
    ]).toEqual([
      { job: -1, answer: { ran: 'unreadable' }, keep: false },
      { job: 8, answer: { ran: 'unreadable' }, keep: false },
      { job: 9, answer: { ran: 'unreadable' }, keep: false },
      { job: 10, answer: { ran: 'unreadable' }, keep: false },
      { job: 11, answer: { ran: 'unreadable' }, keep: false },
    ]);
  });
});

describe.each(sourcesUnderTest)('the output checks a loop keeps between jobs on $name instances', ({ name }) => {
  it('compiles the check of a context once for each schema, and checks nothing when a job gives none or the loop was given no checks', async () => {
    const compiled: Json[] = [];
    const output = (schema: Json): OutputCheck => {
      compiled.push(schema);
      return refusingEvery('refused by the check');
    };
    const ask = served(name, { program: answerOf, checks: { output, view: () => () => 'never asked' } });
    const string = { context: { type: 'string' } };
    const echo = program('return input;');

    expect(
      await inTurn(ask, [programJob(1, echo, string), programJob(2, echo, string), programJob(3, echo)]),
    ).toMatchObject([
      { answer: { ran: 'mismatched', issues: [{ detail: 'refused by the check' }] } },
      { answer: { ran: 'mismatched' } },
      { answer: { ran: 'answered' } },
    ]);
    expect(compiled).toEqual([{ type: 'string' }]);
    expect(await served(name, { program: answerOf })(programJob(4, echo, string))).toMatchObject({
      answer: { ran: 'answered' },
    });
  });
});

describe.each(sourcesUnderTest)('the view checks a loop keeps between pages on $name instances', ({ name }) => {
  it('compiles the check of a schema once for each schema, and stalls every view that keeps one when it was given no checks', async () => {
    const compiled: Json[] = [];
    const view = (schema: JsonObject): (() => string) => {
      compiled.push(schema);
      return () => 'refused by the check';
    };
    const ask = served(name, { fold: foldAnswerOf, checks: { output: () => refusingEvery('never asked'), view } });
    const integer = { schema: { type: 'integer' } };

    expect(await inTurn(ask, [foldJob(1, [integer, integer]), foldJob(2, [integer])])).toMatchObject([
      { answer: { views: [{ stall: { message: 'refused by the check' } }, { stall: { kind: 'schema' } }] } },
      { answer: { views: [{ stall: { kind: 'schema' } }] } },
    ]);
    expect(compiled).toEqual([{ type: 'integer' }]);
    expect(await served(name, { fold: foldAnswerOf })(foldJob(3, [integer]))).toMatchObject({
      answer: { views: [{ stall: { kind: 'schema', message: noSchemaChecked } }] },
    });
  });
});
