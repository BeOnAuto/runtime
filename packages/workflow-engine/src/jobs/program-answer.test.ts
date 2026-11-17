import { type RecordedSpan, recordingTracer } from '@on.auto/operations/testing';
import { Effect, Metric, Tracer } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import type { InstanceSource } from '../instances/instance-source.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import { keptFor } from '../worker.ts';
import { pooledJob } from './pooled-jobs.ts';
import { answerOf, type OutputIssue, type ProgramHost, unchecked } from './program-answer.ts';
import type { ProgramJob } from './program-messages.ts';

async function hostOf(source: InstanceSource, more: Partial<ProgramHost> = {}): Promise<ProgramHost> {
  return {
    now: () => 0,
    instance: await source(unitMemoryBytes),
    check: unchecked,
    ...more,
  };
}

const request: ProgramJob = {
  source: 'export default function (input) {\n  return input.map((item) => item + 1);\n}',
  entry: 'default',
  arguments: ['[1, 2]'],
  moment: 0,
  budget: 500,
  memoryBytes: unitMemoryBytes,
  stackBytes: threadStackBytes,
  deadlineAt: 10_000,
  mostOutputBytes: 1000,
  context: null,
};

function answeringAtMostTen(body: string): ProgramJob {
  return { ...request, source: `export default function () {\n  return ${body};\n}`, mostOutputBytes: 10 };
}

function refusing(output: unknown): readonly OutputIssue[] {
  return [
    { pointer: `/${'k'.repeat(2000)}`, detail: 'Expected no excess property' },
    { pointer: '', detail: `got ${JSON.stringify(output)} ${'x'.repeat(2000)}` },
  ];
}

function schemaOf(title: string, padding = 100_000): JsonObject {
  return { title, description: '.'.repeat(padding) };
}

function compiledFor(schemas: readonly Json[]): readonly unknown[] {
  const compiled: unknown[] = [];
  const kept = keptFor({
    output: (schema) => {
      compiled.push(Reflect.get(new Object(schema), 'title'));
      return unchecked;
    },
    view: () => () => ({ kind: 'schema', detail: 'never asked' }),
  });
  for (const schema of schemas) {
    kept.outputCheck(schema);
  }
  return compiled;
}

interface Duration {
  readonly attributes: Metric.Metric.AttributeSet | undefined;
  readonly state: unknown;
}

interface Measured {
  readonly spans: readonly RecordedSpan[];
  readonly durations: readonly Duration[];
}

async function measured<Outcome>(job: Effect.Effect<Outcome>): Promise<Measured> {
  const recording = recordingTracer();
  const snapshots = await Effect.runPromise(
    Effect.andThen(job, Metric.snapshot).pipe(
      Effect.provideService(Tracer.Tracer, recording.tracer),
      Effect.provideService(Metric.MetricRegistry, new Map()),
    ),
  );
  const durations: Duration[] = [];
  for (const { id, attributes, state } of snapshots) {
    if (id === 'auto.on.pool.job.duration') {
      durations.push({ attributes, state });
    }
  }
  return { spans: recording.spans(), durations };
}

describe.each(sourcesUnderTest)('the answer of a worker on $name instances', ({ source }) => {
  it('runs the program it is given on the arguments it is given', async () => {
    expect(answerOf(request, await hostOf(source))).toEqual({ ran: 'answered', output: '[2,3]', bytes: 5, work: 0 });
  });

  it('answers a program that does not load as refused, and a failure with its issue cut at 1,024 bytes', async () => {
    expect(answerOf({ ...request, source: 'export const x = 1;' }, await hostOf(source))).toEqual({
      ran: 'refused',
      issue: { detail: 'The program exports no function default', line: null },
    });
    expect(
      answerOf(
        { ...request, source: 'export default function () {\n  throw new Error("x".repeat(3000));\n}' },
        await hostOf(source),
      ),
    ).toEqual({ ran: 'raised', issue: { detail: `Error: ${'x'.repeat(1017)}…`, line: 2 }, work: 0 });
  });

  it('answers an output larger than it may give as oversized, in characters in the sandbox and in bytes outside it', async () => {
    expect(answerOf(answeringAtMostTen('"x".repeat(20)'), await hostOf(source))).toEqual({ ran: 'oversized', work: 0 });
    expect(answerOf(answeringAtMostTen('"é".repeat(5)'), await hostOf(source))).toEqual({ ran: 'oversized', work: 0 });
  });
});

describe.each(sourcesUnderTest)('the answer of a worker that checks the output on $name instances', ({ source }) => {
  it('answers the output when the check finds nothing, and the issues it finds when it does, the pointer and the detail of each cut at 1,024 bytes apart', async () => {
    expect(answerOf(request, await hostOf(source))).toMatchObject({ ran: 'answered', output: '[2,3]' });
    expect(answerOf(request, await hostOf(source, { check: refusing }))).toEqual({
      ran: 'mismatched',
      issues: [
        { pointer: `/${'k'.repeat(1023)}…`, detail: 'Expected no excess property' },
        { pointer: '', detail: `got [2,3] ${'x'.repeat(1014)}…` },
      ],
      work: 0,
    });
  });
});

describe('the checks keptFor keeps, as the worker entry exports it for a shell that serves the jobs itself', () => {
  it('compiles a schema once and keeps it while its text fits the cache, forgetting the one used longest ago', () => {
    const [first, second, third] = [schemaOf('first'), schemaOf('second'), schemaOf('third')];

    expect(compiledFor([first, second, first, third, first, second])).toEqual(['first', 'second', 'third', 'second']);
  });

  it('compiles a schema longer than the cache for every job, and checks no output whose schema is null', () => {
    const longest = schemaOf('longest', 262_145);

    expect(compiledFor([longest, longest, null, null])).toEqual(['longest', 'longest']);
  });
});

describe('a job run in a pool of workers', () => {
  it('is a span named for the pool of programs and its kind, saying how it ended and how long it ran', async () => {
    const { spans, durations } = await measured(
      pooledJob('computation', () => Promise.resolve({ ran: 'answered', text: 'null', milliseconds: 120 })),
    );

    expect(spans).toMatchObject([
      {
        name: 'program computation',
        ending: 'succeeded',
        attributes: {
          'auto.on.pool': 'program',
          'auto.on.pool.kind': 'computation',
          'auto.on.pool.ending': 'answered',
          'auto.on.pool.milliseconds': 120,
        },
      },
    ]);
    expect(durations.map(({ attributes }) => attributes)).toEqual([
      { 'auto.on.pool': 'program', 'auto.on.pool.kind': 'computation', 'auto.on.pool.ending': 'answered' },
    ]);
    expect(durations.map(({ state }) => state)).toMatchObject([{ count: 1, sum: 0.12 }]);
  });
});
