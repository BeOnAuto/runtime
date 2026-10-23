import { checkedWorker } from '@on.auto/definitions';
import { programPool, type ProgramRequest } from '@on.auto/workflow-engine/dsl';

import { computationBounds } from '../src/run/run-bounds.ts';
import { formatted, functionOf, handed, inTurn, median, request } from './common.ts';

const jobs = 200;

const permits = 4;

const rounds = 3;

const withASchema = { worker: checkedWorker, context: { type: 'integer' } };

type Naming = (index: number) => Partial<ProgramRequest>;

interface Turn {
  readonly two: number;
  readonly one: number;
}

const twoModules: Naming = (index) => (index % 2 === 0 ? {} : withASchema);

const oneModule: Naming = (index) => (index % 2 === 0 ? { worker: checkedWorker, context: null } : withASchema);

async function burstOf(naming: Naming): Promise<number> {
  const pool = programPool({
    handed,
    instances: 'fresh',
    workers: permits,
    heapMegabytes: computationBounds.heapMegabytes,
  });
  const started = performance.now();
  await Promise.all(
    Array.from({ length: jobs }, (_, index) =>
      pool.run({ ...request(functionOf('return input;'), index), ...naming(index) }),
    ),
  );
  const milliseconds = performance.now() - started;
  await pool.close();
  return milliseconds;
}

export async function burstMeasured(): Promise<string> {
  const turns = await inTurn(Array.from({ length: rounds }), async (): Promise<Turn> => ({
    two: await burstOf(twoModules),
    one: await burstOf(oneModule),
  }));
  const two = turns.map(({ two: each }) => each);
  const one = turns.map(({ one: each }) => each);
  return `${jobs} jobs at once on ${permits} permits, half with an output schema, ${rounds} times in turn: ${formatted(median(two))} ms at the median when those without one name the pool's plain worker, ${formatted(median(one))} ms when every job names the checked worker (${two.map((each) => formatted(each)).join(', ')} and ${one.map((each) => formatted(each)).join(', ')} ms)`;
}
