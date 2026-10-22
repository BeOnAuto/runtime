import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { decidedOnce } from '../pool-testing/decided-once.ts';
import { churn, evaluatedAt } from '../pool-testing/evaluation-workers.ts';
import { machineOnTheThread, testPoolSettings } from '../pool-testing/test-pools.ts';
import { threadsAlive } from '../pool-testing/threads-alive.ts';
import { longerThanTheTestMs } from '../pool-testing/waiting.ts';
import type { Evaluation, ProgramRun } from '../programs/program-run.ts';
import { answerGraceMs } from './evaluation-thread.ts';
import { programPool } from './program-pool.ts';

type ProgramPool = ReturnType<typeof programPool>;

type PoolSettings = Parameters<typeof programPool>[0];

type Machine = ProgramPool['evaluations']['machine'];

const severalTimesSlowerMs = 3000;

const pools: ProgramPool[] = [];

const filling = '(() => { const kept = []; for (;;) { kept.push("x".repeat(1048576) + kept.length); } })()';

const caughtStackBomb =
  '(() => { const deeper = (depth) => { try { return deeper(depth + 1); } catch { return depth; } }; return deeper(0); })()';

const runtimeError: unknown = expect.stringMatching(/\/errors\/runtime$/u);

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ ...testPoolSettings(1), ...settings });
  pools.push(pool);
  return pool;
}

function within(machine: Machine, milliseconds: number): Evaluation {
  return { budget: 250, deadlineAt: machine.clock() + milliseconds, moment: evaluatedAt };
}

function evaluatedIn(machine: Machine, source: string, milliseconds = 2000): ProgramRun {
  const unit = machine.unit();
  try {
    return unit.evaluate(source, {}, within(machine, milliseconds));
  } finally {
    unit.close();
  }
}

function nested<Answer>(depth: number, then: () => Answer): Answer {
  return depth === 0 ? then() : nested(depth - 1, then);
}

async function timed<Answer>(work: () => Answer | Promise<Answer>): Promise<{ answer: Answer; ms: number }> {
  const started = performance.now();
  const answer = await work();
  return { answer, ms: performance.now() - started };
}

describe('the evaluation worker of a pool asked before any reserve', () => {
  it('starts with the module of the sandbox the settings of the pool hand it, and answers once it is ready', () => {
    const { machine } = poolOf().evaluations;

    expect(evaluatedIn(machine, '1 + 1', longerThanTheTestMs)).toMatchObject({ ran: 'answered', text: '2' });
  });
});

describe('the evaluation worker of a pool, given native work that no checkpoint interrupts', () => {
  it('ends the expression of a decision at the input deadline, within about 2.1 s, and decides the next input on a fresh worker', async () => {
    const { machine } = poolOf().evaluations;
    const churning = `do:\n  - churn: { set: { churned: '\${ ${churn} }' } }`;
    await Effect.runPromise(machine.reserve);

    const { answer: ended, ms } = await timed(() => decidedOnce(machine, churning, evaluatedAt));
    await Effect.runPromise(machine.reserve);
    const next = decidedOnce(machine, 'do:\n  - add: { set: { sum: "${ 1 + 1 }" } }', evaluatedAt);

    expect(ended.outcome).toMatchObject({ kind: 'raised', error: { type: runtimeError, status: 500 } });
    expect(JSON.stringify(ended.outcome)).toContain(
      'The program ran past its deadline: the expressions of one input may take 2000 ms',
    );
    expect(ms).toBeGreaterThan(2000);
    expect(ms).toBeLessThan(2000 + answerGraceMs + severalTimesSlowerMs);
    expect(next.outcome).toEqual({ kind: 'completed', output: { sum: 2 } });
  });
});

describe('the evaluation worker of a pool, given a stack or a memory to exhaust', () => {
  it("gives a caught stack bomb one answer, from the shallow stack of the host, from 5,000 frames deep and on a host's own thread", async () => {
    const { machine } = poolOf().evaluations;
    const here = machineOnTheThread();
    await Promise.all([Effect.runPromise(machine.reserve), Effect.runPromise(here.reserve)]);

    const shallow = evaluatedIn(machine, caughtStackBomb);
    const deep = nested(5000, () => evaluatedIn(machine, caughtStackBomb));
    const onTheThread = evaluatedIn(here, caughtStackBomb);

    expect(shallow).toMatchObject({ ran: 'answered' });
    expect([deep, onTheThread]).toEqual([shallow, shallow]);
  });

  it('raises a runtime error, status 500, from a decision whose expression fills its sandbox', async () => {
    const { machine } = poolOf().evaluations;
    await Effect.runPromise(machine.reserve);

    const filled = `do:\n  - fill: { set: { filled: '\${ ${filling} }' } }`;
    const ended = decidedOnce(machine, filled, evaluatedAt, 30_000);

    expect(ended.outcome).toMatchObject({ kind: 'raised', error: { type: runtimeError, status: 500 } });
    expect(JSON.stringify(ended.outcome)).toContain(
      'The program used more memory than it may: the expressions of one input may use the memory of their sandbox and no more',
    );
  });

  it('ends a unit whose instance refused to grow, and answers the next unit on a fresh worker', async () => {
    const { machine } = poolOf().evaluations;
    await Effect.runPromise(machine.reserve);
    const unit = machine.unit();

    const runs = [
      unit.evaluate(filling, {}, within(machine, 10_000)),
      unit.evaluate('1 + 1', {}, within(machine, 10_000)),
    ];
    unit.close();
    await Effect.runPromise(machine.reserve);
    const next = evaluatedIn(machine, '1 + 1');

    expect(runs).toMatchObject([
      { ran: 'exhausted', limit: 'memory' },
      { ran: 'exhausted', limit: 'memory', work: 0 },
    ]);
    expect(next).toMatchObject({ ran: 'answered', text: '2' });
  });
});

describe('the evaluation worker of a pool that cannot answer', () => {
  it('starts no worker once the pool closed, and ends an evaluation at once, however far off its deadline', async () => {
    const pool = poolOf();
    await pool.close();
    const before = threadsAlive();

    await Effect.runPromise(pool.evaluations.machine.reserve);
    const answer = evaluatedIn(pool.evaluations.machine, '1 + 1', longerThanTheTestMs);

    expect(answer).toMatchObject({ ran: 'exhausted', limit: 'deadline', work: 0 });
    expect(threadsAlive()).toBe(before);
  });

  it('ends an evaluation at its deadline while the worker it started has not loaded, and never ends a worker that is loading', async () => {
    const broken = new URL(`data:text/javascript,${encodeURIComponent("throw new Error('broken on purpose');")}`);
    const { machine } = poolOf({ evaluationWorker: broken }).evaluations;

    await Effect.runPromise(machine.reserve);
    const { answer, ms } = await timed(() => evaluatedIn(machine, '1 + 1', 200));

    expect(answer).toMatchObject({ ran: 'exhausted', limit: 'deadline', work: 0 });
    expect(ms).toBeGreaterThan(150);
    expect(ms).toBeLessThan(200 + answerGraceMs + severalTimesSlowerMs);
  });
});
