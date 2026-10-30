import { mostInputBytes } from '@on.auto/definitions';
import { jsonBytesOf, type ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Result } from 'effect';

import { documentCheck } from '../src/document/document-check.ts';
import { parseComputationDocument } from '../src/document/document-parsing.ts';
import { campaignPace, campaignRows } from '../src/testing/campaign-pace.ts';
import { formatted, inTurn, median, poolOfOne, request } from './common.ts';

async function strippedProgram(pool: ProgramPool): Promise<string> {
  const document = Result.getOrThrow(parseComputationDocument(campaignPace));
  const { module = document.program } = await Effect.runPromise(documentCheck(pool)(document));
  return module;
}

function mostRowsWithinTheInput(): number {
  let low = 1;
  let high = 100_000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (jsonBytesOf(campaignRows(middle)) <= mostInputBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

async function workOf(pool: ProgramPool, source: string, rows: number): Promise<string> {
  const ran = await pool.run(request(source, campaignRows(rows)));
  return ran.ran === 'answered' ? formatted(ran.work) : ran.ran;
}

export async function exampleMeasured(): Promise<readonly string[]> {
  const pool = poolOfOne();
  const source = await strippedProgram(pool);
  const most = mostRowsWithinTheInput();
  const sizes = [1000, 2000, 4000, most];
  const checkpoints = await inTurn(
    sizes,
    async (rows) => `${await workOf(pool, source, rows)} for ${formatted(rows)} rows`,
  );
  const input = campaignRows(most);
  const times = await inTurn(
    Array.from({ length: 21 }),
    async () => (await pool.run(request(source, input))).milliseconds,
  );
  await pool.close();
  return [
    `the example's checkpoints, in a worker: ${checkpoints.join(', ')}`,
    `the example at the most rows its input takes, ${formatted(most)} rows of ${formatted(jsonBytesOf(input))} bytes: ${formatted(median(times), 1)} ms at the median of ${times.length} warm runs, in a fresh sandbox each`,
  ];
}
