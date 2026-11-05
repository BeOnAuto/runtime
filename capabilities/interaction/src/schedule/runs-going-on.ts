import { runCorrelationIn, type RunStreamAddress } from '@on.auto/definitions';
import { playbookRowsOf, type Lineage, type PlaybookProjectedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom } from '../requests/request-rows.ts';
import type { RequestLedger } from './request-ledger.ts';

export type GoOn = (run: RunStreamAddress, lineage: Lineage) => Effect.Effect<void, unknown>;

export interface GoingOnParts {
  readonly ledger: Pick<RequestLedger, 'readRecorded' | 'readDueRows' | 'nextDueOf'>;
  readonly goOn: GoOn;
}

interface RunGoingOn {
  readonly key: string;
  readonly callsOut: boolean;
  readonly perform: (now: number) => Effect.Effect<void, unknown>;
}

export interface RunsGoingOn {
  readonly name: string;
  readonly due: (now: number, most: number, callsOut: boolean) => Effect.Effect<readonly RunGoingOn[]>;
  readonly nextDueAt: (after: number, callsOut?: boolean) => Effect.Effect<number | null>;
}

const goOnDue = 'go_on_due_at';

function itemOf({ ledger, goOn }: GoingOnParts, kept: PlaybookProjectedRow): RunGoingOn {
  const run = { org: kept.org, playbook: kept.playbook, id: kept.key };
  const { request_id: causationId } = requestRowFrom(kept.row);
  return {
    key: `${kept.org}/${kept.playbook}/${kept.key}`,
    callsOut: true,
    perform: () =>
      Effect.flatMap(runCorrelationIn(ledger, run), (correlationId) => goOn(run, { causationId, correlationId })),
  };
}

export function runsGoingOn(parts: GoingOnParts): RunsGoingOn {
  const { ledger } = parts;
  return {
    name: 'the runs that go on once their requests are answered or expire',
    due: (now, most, callsOut) =>
      callsOut
        ? Effect.map(ledger.readDueRows(openRequestsName, { column: goOnDue, through: now, limit: most }), (rows) =>
            playbookRowsOf(openRequestsName, rows).map((kept) => itemOf(parts, kept)),
          )
        : Effect.succeed([]),
    nextDueAt: (after, callsOut = true) =>
      callsOut ? ledger.nextDueOf(openRequestsName, goOnDue, after) : Effect.succeed(null),
  };
}
