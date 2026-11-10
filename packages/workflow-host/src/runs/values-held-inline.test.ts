import { mostInlineHeldValueBytes, stateFormat } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { ledgerRunLogStore } from './ledger-run-store.ts';
import { runKeyOf } from './run-address.ts';

const run = runAt('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b');

const large = 'x'.repeat(mostInlineHeldValueBytes + 1);

const holding = workflow(`
do:
  - hold: { set: '\${ ({ text: "x".repeat(${mostInlineHeldValueBytes + 1}) }) }' }
  - pause: { wait: PT1H }
`);

describe('the engine the host composes', () => {
  it('keeps every value a run holds inline in its log, past the size a store of payloads would keep outside, writing format 11, since the host composes no store of payloads', async () => {
    const file = aSQLiteFile();
    const hosted = await hostedOn({ store: 'sqlite', file });
    await Effect.runPromise(hosted.host.start(run, startOf(holding)));

    const stored = await Effect.runPromise(
      ledgerRunLogStore(await openedOn({ store: 'sqlite', file })).load(runKeyOf(run)),
    );

    expect(stored.tail.map(({ event }) => [event.format, 'kept' in event])).toEqual([[stateFormat, false]]);
    expect(JSON.stringify(stored.tail)).toContain(large);
  });
});
