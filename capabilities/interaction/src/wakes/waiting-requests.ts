import { payloadAsRead, payloadsKeptIn, recordedRunIn, type KeptContentReader } from '@on.auto/definitions';
import { renderClock } from '@on.auto/definitions/template';
import type { RenderedArguments } from '@on.auto/definitions/tool-blocks';
import type {
  LedgerPorts,
  PlaybookAddress,
  ProjectedKeyedRow,
  ProjectionReader,
  StreamReader,
} from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom } from '../requests/request-rows.ts';
import { deliveringRecordIn } from '../run/request-record.ts';
import { deliveryArgumentsOf } from '../tool-blocks/delivery-arguments.ts';

export interface WaitingRequest {
  readonly connection: string;
  readonly with: Readonly<Record<string, Schema.Json>>;
  readonly sent: { readonly conversation: string; readonly id: string };
}

export interface WaitingParts {
  readonly ledger: Pick<ProjectionReader, 'readProjectedRows'> &
    StreamReader &
    Pick<LedgerPorts, 'holderOfStream'> &
    KeptContentReader;
  readonly mostRequestBytesTo: (server: string) => number;
}

const openRequestsInAPage = 100;

interface Paging {
  readonly playbook: PlaybookAddress;
  readonly inAPage: number;
}

function openPageAfter(parts: WaitingParts, { playbook, inAPage }: Paging, last?: ProjectedKeyedRow) {
  return parts.ledger.readProjectedRows(openRequestsName, playbook, {
    where: [{ column: 'open', equals: true }],
    orderBy: ['requested_at'],
    order: 'asc',
    limit: inAPage,
    ...(last === undefined ? {} : { after: [requestRowFrom(last.row).requested_at, last.key] }),
  });
}

function openRowsOf(parts: WaitingParts, paging: Paging): Effect.Effect<readonly ProjectedKeyedRow[]> {
  return Effect.gen(function* () {
    const open: ProjectedKeyedRow[] = [];
    let page = yield* openPageAfter(parts, paging);
    open.push(...page);
    while (page.length === paging.inAPage) {
      page = yield* openPageAfter(parts, paging, page.at(-1));
      open.push(...page);
    }
    return open;
  });
}

function waitingIn(
  parts: WaitingParts,
  playbook: PlaybookAddress,
  kept: ProjectedKeyedRow,
): Effect.Effect<WaitingRequest | undefined> {
  const row = requestRowFrom(kept.row);
  const { sent_conversation: conversation, sent_id: id } = row;
  if (conversation === null || id === null) {
    return Effect.undefined;
  }
  const address = { ...playbook, id: kept.key };
  return Effect.gen(function* () {
    const recorded = yield* recordedRunIn(parts.ledger, address);
    const record = recorded === undefined ? undefined : deliveringRecordIn(recorded.run.record);
    if (recorded === undefined || record === undefined) {
      return yield* Effect.undefined;
    }
    const input = yield* payloadAsRead(recorded.input, payloadsKeptIn(parts.ledger.content, address));
    const { server } = record.deliver;
    const rendering = { clock: yield* renderClock, mostBytes: parts.mostRequestBytesTo(server) };
    const rendered: Result.Result<RenderedArguments, unknown> =
      'read' in input
        ? deliveryArgumentsOf(
            record.deliver.with,
            record,
            { input: input.read, runId: address.id, functionName: row.function },
            rendering,
          )
        : Result.fail(input.unread);
    return Result.getOrUndefined(
      Result.map(rendered, ({ input: delivered }) => ({
        connection: server,
        with: delivered,
        sent: { conversation, id },
      })),
    );
  });
}

export function waitingRequestsOf(
  parts: WaitingParts,
  playbook: PlaybookAddress,
  inAPage = openRequestsInAPage,
): Effect.Effect<readonly WaitingRequest[]> {
  return Effect.flatMap(openRowsOf(parts, { playbook, inAPage }), (rows) =>
    Effect.map(
      Effect.forEach(rows, (kept) => waitingIn(parts, playbook, kept)),
      (waiting: readonly (WaitingRequest | undefined)[]) => waiting.filter((each) => each !== undefined),
    ),
  );
}
