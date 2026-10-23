import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { runMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import { programPool } from './program-pool.ts';

const pools: ProgramPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function keepingPool(): ProgramPool {
  const pool = programPool({ ...testPoolSettings(1), instances: 'kept' });
  pools.push(pool);
  return pool;
}

function request(body: string): ProgramRequest {
  return {
    source: `export default function (input) {\n  ${body}\n}`,
    entry: 'default',
    arguments: [1],
    moment: 0,
    budget: 20_000,
    memoryBytes: runMemoryBytes,
    stackBytes: workerStackBytes,
    deadlineMs: 10_000,
    mostOutputBytes: 1000,
  };
}

describe('a pool whose workers keep their instances between units', () => {
  it('runs each program on a fresh runtime of a kept instance, so nothing one run leaves reaches the next', async () => {
    const pool = keepingPool();

    const runs = [
      await pool.run(
        request('Reflect.set(globalThis, "seen", input);\n  return typeof Reflect.get(globalThis, "seen");'),
      ),
      await pool.run(request('return typeof Reflect.get(globalThis, "seen");')),
    ];

    expect(runs).toMatchObject([
      { ran: 'answered', output: 'number' },
      { ran: 'answered', output: 'undefined' },
    ]);
  });

  it('decides the expressions of an input in its evaluation worker on a kept instance too', async () => {
    const { machine } = keepingPool().evaluations;
    await Effect.runPromise(machine.reserve);
    const unit = machine.unit();
    const decided = unit.evaluate(
      '$data + 1',
      { data: 41 },
      { budget: 250, deadlineAt: machine.clock() + 10_000, moment: 0 },
    );
    unit.close();

    expect(decided).toMatchObject({ ran: 'answered', text: '42' });
  });
});
