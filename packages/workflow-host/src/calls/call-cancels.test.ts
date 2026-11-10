import { statement } from '@on.auto/ledger';
import { callKeyText, type CancelCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { cancelledCall } from './call-cancels.ts';
import { callRowOf } from './call-rows.ts';

const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const call: CancelCall = {
  kind: 'cancel_call',
  key: { runId: runKey, reference: '/do/0/ask', run: 1 },
  reason: 'deadline',
};

const key = callKeyText(call.key);

function startedAfterItsFirstRead(database: HostDatabase): HostDatabase {
  const started = database.write(
    statement`INSERT INTO workflow_calls (call_key, run_key, state) VALUES (${key}, ${runKey}, 'running')
      ON CONFLICT (call_key) DO NOTHING`,
  );
  return { ...database, read: (asked) => Effect.tap(database.read(asked), () => started) };
}

describe('the cancel of a call no row of which was read', () => {
  it('cancels by its state the row a start recorded between its read and its tombstone, and answers no close of a run that is not closed', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const interrupted: string[] = [];

    const receipt = await Effect.runPromise(
      cancelledCall(
        {
          database: startedAfterItsFirstRead(database),
          cancelChild: () => Effect.succeed('requested'),
          interrupt: (interruptedKey) =>
            Effect.sync(() => {
              interrupted.push(interruptedKey);
            }),
        },
        { call, run: { runId: runKey, attributes: {} }, origin: { version: 3 } },
      ),
    );

    expect([receipt, interrupted]).toEqual(['cancelled', [key]]);
    expect(await Effect.runPromise(callRowOf(database, key))).toMatchObject({ state: 'cancelled' });
  });
});
