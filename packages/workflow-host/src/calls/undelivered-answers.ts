import { statement } from '@on.auto/ledger';
import { Schema, type Effect } from 'effect';

import { rowsOf, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { CallText, ResultText } from './call-rows.ts';

const UndeliveredRow = Schema.Struct({ call: CallText, result: ResultText });

type UndeliveredAnswer = typeof UndeliveredRow.Type;

export function undeliveredAnswersOf(
  database: HostDatabase,
  runKey: string,
): Effect.Effect<readonly UndeliveredAnswer[], DatabaseFailed> {
  return rowsOf(
    UndeliveredRow,
    database.read(
      statement`SELECT call, result FROM workflow_calls
        WHERE run_key = ${runKey} AND state <> 'closed' AND state = 'answered' AND delivered = 0
        ORDER BY call_key`,
    ),
  );
}
