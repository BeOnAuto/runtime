import { statement } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keyOfTheRun, ranOn } from '../closing-testing/ended-runs.ts';
import { sqlWatermark } from './sql-watermark.ts';

const run = '0199a3c4-7d2e-7c1a-9b3f-00000000000a';

describe('the runs whose dispatch is behind the version of their log', () => {
  it('leaves out a run whose log the event store archived, with its own mark, as a run whose log was never written', async () => {
    const database = await ranOn([run]);
    await Effect.runPromise(database.write(statement`UPDATE workflow_runs SET dispatched_through = 0`));
    const watermark = sqlWatermark(database);

    const behind = await Effect.runPromise(watermark.behindRuns(10));
    await Effect.runPromise(
      Effect.forEach(
        [
          statement`UPDATE emt_streams SET is_archived = TRUE WHERE stream_id IN (SELECT stream_id FROM workflow_runs)`,
          statement`UPDATE emt_messages SET is_archived = TRUE WHERE stream_id IN (SELECT stream_id FROM workflow_runs)`,
        ],
        (archived) => database.write(archived),
        { discard: true },
      ),
    );
    const behindAfterTheArchive = await Effect.runPromise(watermark.behindRuns(10));

    expect([behind, behindAfterTheArchive]).toEqual([[keyOfTheRun(run)], []]);
  });
});
