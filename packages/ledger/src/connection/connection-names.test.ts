import { ContextSchema, noLineage } from '@on.auto/operations';
import { definitionsPlaced } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderOf } from '../event-appender.ts';
import { ledgerLayer } from '../sqlite.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';

const AnyFact = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: ContextSchema });

describe('a fact of a definition appended through the streams of the connection', () => {
  it('changes the definition’s row of names in its append, as an append of the ledger does', async () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);
    const opened = await openConnectionWith(ledgerLayer({ fileName, definitionNames: definitionsPlaced }));
    onTestFinished(opened.dispose);

    await Effect.runPromise(
      eventAppenderOf(opened.connection.streams, AnyFact)(
        'definition/acme/d1/remarks/placed',
        [{ type: 'remark_made', data: { text: 'alpha' } }],
        { expectedVersion: 0, context: { by: 'acme-admin', at: '2026-11-16T09:00:00.000Z' }, lineage: noLineage },
      ),
    );

    expect((await Effect.runPromise(opened.ledger.nameHeldBy('definition/acme/d1/')))?.playbookKey).toBe(
      'playbook/acme/alpha/',
    );
  });
});
