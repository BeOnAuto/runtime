import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom } from '../requests/request-rows.ts';
import { choiceDocument, choiceInputValue, clicking } from '../testing/clicked-cards.ts';
import { alpha } from '../testing/interaction-harness.ts';
import { drawnCallOf } from './drawn-calls.ts';

const firstRow = Schema.decodeUnknownSync(
  Schema.NonEmptyArray(
    Schema.Struct({
      key: Schema.String,
      row: Schema.Record(Schema.String, Schema.NullOr(Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))),
    }),
  ),
);

describe('the call that draws the card of a request again', () => {
  it('is none for a run that is not there, and the call that updates the message for one that is', async () => {
    const { playbook } = await clicking(choiceDocument, choiceInputValue);
    const rows = await Effect.runPromise(
      playbook.ledger.service.readProjectedRows(openRequestsName, alpha, {
        where: [],
        orderBy: [],
        order: 'asc',
        limit: 1,
      }),
    );
    const [{ key, row: stored }] = firstRow(rows);
    const row = requestRowFrom(stored);
    const parts = { ledger: playbook.ledger.service, tools: playbook.chat, record: playbook.record };

    const missing = await Effect.runPromise(
      drawnCallOf(parts, { ...alpha, id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b00' }, row, false),
    );
    const drawn = await Effect.runPromise(drawnCallOf(parts, { ...alpha, id: key }, row, true));

    expect(missing).toBeUndefined();
    expect(drawn).toMatchObject({ about: 'drawn', form: 'update', tool: 'update_message' });
  });
});
