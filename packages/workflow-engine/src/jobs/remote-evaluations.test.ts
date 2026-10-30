import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import { filterVerdictsOf } from '../filters/filter-verdicts.ts';
import { exhaustedBy, type Evaluation, type ProgramRun } from '../programs/program-run.ts';
import type { AnsweredRequest } from './evaluation-messages.ts';
import { remoteEvaluations, type EvaluationAsks, type EvaluationCalls } from './remote-evaluations.ts';

interface Asked {
  readonly request: AnsweredRequest;
  readonly waitMs: number;
}

interface FakeCalls {
  readonly calls: EvaluationCalls;
  readonly asks: EvaluationAsks;
  readonly asked: readonly Asked[];
  readonly released: readonly number[];
  readonly clock: { at: number; readies: number };
}

const now = Date.parse('2026-10-01T09:00:00.000Z');

const event: JsonObject = { type: 'com.acme.closed', data: 'eu' };

function answered(text: string): ProgramRun {
  return { ran: 'answered', text, work: 1 };
}

function scripted(runs: readonly ProgramRun[], otherwise: ProgramRun): () => ProgramRun {
  const remaining = [...runs];
  return () => remaining.shift() ?? otherwise;
}

function firstTestHolds(request: AnsweredRequest): ProgramRun {
  return answered(request.kind === 'test' ? String(request.test === 0) : 'null');
}

function filterOf(reference: string, data: string) {
  return { reference, attributes: { type: 'com.acme.closed', data } };
}

function fakeCalls(
  answer: (request: AnsweredRequest) => ProgramRun,
  msPerCall = 0,
  unprepared: readonly boolean[] = [],
): FakeCalls {
  const asked: Asked[] = [];
  const unpreparedTests = [...unprepared];
  const released: number[] = [];
  const clock = { at: 0, readies: 0 };
  return {
    calls: {
      ready: () => {
        clock.readies += 1;
        clock.at += 500;
        return Promise.resolve();
      },
      call: (request, waitMs) => {
        asked.push({ request, waitMs });
        clock.at += msPerCall;
        return answer(request);
      },
      release: (unit) => {
        released.push(unit);
      },
    },
    asks: {
      ready: () => {
        clock.readies += 1;
        clock.at += 500;
        return Promise.resolve();
      },
      prepare: (request, waitMs) => {
        asked.push({ request, waitMs });
        clock.at += msPerCall;
        return Promise.resolve(answer(request));
      },
      test: (request, waitMs) => {
        asked.push({ request, waitMs });
        clock.at += msPerCall;
        return Promise.resolve(unpreparedTests.shift() === true ? 'unprepared' : answer(request));
      },
      release: (unit) => {
        released.push(unit);
      },
    },
    asked,
    released,
    clock,
  };
}

function evaluationAt(deadlineAt: number): Evaluation {
  return { budget: 250, deadlineAt, moment: now };
}

describe('the sandbox of a machine whose units another thread evaluates', () => {
  it('waits for the thread before an input, sends an expression with only the values it names, waits until its deadline and releases the unit', async () => {
    const fake = fakeCalls(() => answered('42'));
    const { machine } = remoteEvaluations(fake.calls, fake.asks, () => fake.clock.at);

    await Effect.runPromise(machine.reserve);
    const [first, second] = [machine.unit(), machine.unit()];
    const run = first.evaluate(
      '$data.n * $context.k',
      { data: { n: 6 }, context: { k: 7 }, input: 'unused' },
      evaluationAt(2500),
    );
    first.close();
    second.close();

    expect([run, fake.clock.readies, machine.clock()]).toEqual([answered('42'), 1, 500]);
    expect(fake.asked).toEqual([
      {
        request: {
          kind: 'evaluate',
          unit: 1,
          source: '$data.n * $context.k',
          names: ['data', 'context'],
          texts: ['{"n":6}', '{"k":7}'],
          evaluation: evaluationAt(2500),
        },
        waitMs: 2000,
      },
    ]);
    expect(fake.released).toEqual([1, 2]);
  });
});

describe('a unit of a machine whose expressions another thread evaluates', () => {
  it('ends every later expression of a unit the thread ended by its memory or its deadline, without asking it again, and goes on after any other ending', () => {
    const fake = fakeCalls(
      scripted(
        [exhaustedBy('work', 250), answered('1'), exhaustedBy('memory', 3), exhaustedBy('deadline', 9)],
        answered('1'),
      ),
    );
    const { machine } = remoteEvaluations(fake.calls, fake.asks, () => fake.clock.at);
    const [worked, filled, late] = [machine.unit(), machine.unit(), machine.unit()];

    const runs = [
      worked.evaluate('w()', {}, evaluationAt(2000)),
      worked.evaluate('1', {}, evaluationAt(2000)),
      filled.evaluate('m()', {}, evaluationAt(2000)),
      filled.evaluate('1', {}, evaluationAt(2000)),
      late.evaluate('d()', {}, evaluationAt(2000)),
      late.evaluate('1', {}, evaluationAt(2000)),
    ];

    expect(runs).toEqual([
      exhaustedBy('work', 250),
      answered('1'),
      exhaustedBy('memory', 3),
      exhaustedBy('memory', 0),
      exhaustedBy('deadline', 9),
      exhaustedBy('deadline', 0),
    ]);
    expect(fake.asked).toHaveLength(4);
  });
});

describe('the filters whose contexts another thread keeps', () => {
  it('opens a context once the thread is ready, defines and freezes its sources in one call, and tests each filter under a deadline of its own, 200 ms from its start', async () => {
    const fake = fakeCalls(firstTestHolds, 1500);
    const { filters } = remoteEvaluations(fake.calls, fake.asks, () => fake.clock.at);

    const verdicts = await filterVerdictsOf(
      [filterOf('/eu', '${ $data == "eu" }'), filterOf('/us', '${ $data == "us" }'), filterOf('/any', 'eu')],
      event,
      filters,
      now,
    );

    expect(verdicts).toEqual([true, false, true]);
    expect(fake.asked.map(({ request, waitMs }) => [request.kind, waitMs])).toEqual([
      ['prepare', 2000],
      ['test', 200],
      ['test', 200],
    ]);
    expect(fake.asked[0]?.request).toMatchObject({
      kind: 'prepare',
      unit: 1,
      sources: [' $data == "eu" ', ' $data == "us" '],
      evaluation: { budget: Number.POSITIVE_INFINITY, deadlineAt: 2500, moment: now },
    });
    expect([fake.released, filters.clock()]).toEqual([[1], 5000]);
  });
});

describe('the filters of a context the thread no longer holds', () => {
  it('prepare their sources again when the thread says its fresh worker never had them, and test under the wait the filter started with', async () => {
    const fake = fakeCalls(firstTestHolds, 100, [true]);
    const { filters } = remoteEvaluations(fake.calls, fake.asks, () => fake.clock.at);

    const verdicts = await filterVerdictsOf(
      [filterOf('/eu', '${ $data == "eu" }'), filterOf('/us', '${ $data == "us" }')],
      event,
      filters,
      now,
    );

    expect(verdicts).toEqual([true, false]);
    expect(fake.asked.map(({ request, waitMs }) => [request.kind, request.unit, waitMs])).toEqual([
      ['prepare', 1, 2000],
      ['test', 1, 200],
      ['prepare', 1, 2000],
      ['test', 1, 200],
      ['test', 1, 200],
    ]);
  });
});

describe('the filters of a group whose contexts another thread keeps', () => {
  it('asks the thread nothing for filters that name no expression', async () => {
    const fake = fakeCalls(() => answered('true'));
    const { filters } = remoteEvaluations(fake.calls, fake.asks, () => fake.clock.at);

    const verdicts = await filterVerdictsOf([filterOf('/any', 'eu')], event, filters, now);

    expect([verdicts, fake.asked]).toEqual([[true], []]);
  });

  it('answers every test of a context whose sources did not freeze with that ending, and opens a fresh context for the filters after it', async () => {
    const fake = fakeCalls(scripted([exhaustedBy('deadline', 0), answered('null')], answered('true')));
    const { filters } = remoteEvaluations(fake.calls, fake.asks, () => fake.clock.at);

    const verdicts = await filterVerdictsOf(
      [filterOf('/first', '${ true }'), filterOf('/second', '${ true }')],
      event,
      filters,
      now,
    );

    expect(verdicts).toMatchObject([{ error: { status: 500, instance: '/first' } }, true]);
    expect(fake.asked.map(({ request }) => [request.kind, request.unit])).toEqual([
      ['prepare', 1],
      ['prepare', 2],
      ['test', 2],
    ]);
    expect(fake.released).toEqual([1, 2]);
  });
});
