import {
  addressOfTheRow,
  everyDefinitionOf,
  type PlaybookAddress,
  type ProjectedAddress,
  type ProjectedKeyedRow,
  type ProjectionAdvancer,
  type ProjectionReader,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { readFloorMsOf } from '../conversations/cadence.ts';
import { conversationRowFrom, conversationsName } from '../conversations/conversation-rows.ts';
import { openInConversation } from '../conversations/open-in-conversation.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom } from '../requests/request-rows.ts';

export interface WokenConnection {
  readonly playbook: PlaybookAddress;
  readonly connection: string;
  readonly conversation?: string;
}

export type ConnectionWake = (woken: WokenConnection, now: number) => Effect.Effect<void>;

export interface WakeParts {
  readonly ledger: Pick<ProjectionReader, 'readProjectedRows'> & ProjectionAdvancer;
}

const wakeBounds = { conversations: 100 } as const;

interface Waiting {
  readonly address: ProjectedAddress;
  readonly key: string;
  readonly dueAt: number;
  readonly nextReadAt: number;
}

function waitingIn(kept: ProjectedKeyedRow, connection: string): readonly Waiting[] {
  const row = conversationRowFrom(kept.row);
  const { due_at: dueAt, next_read_at: nextReadAt } = row;
  const readThrough = row.open && row.server === connection && row.waited_after === null;
  return readThrough && dueAt !== null && nextReadAt !== null
    ? [{ address: addressOfTheRow(kept), key: kept.key, dueAt, nextReadAt }]
    : [];
}

function rowsOfTheConnection({ ledger }: WakeParts, { playbook, connection }: WokenConnection) {
  return ledger.readProjectedRows(
    conversationsName,
    { org: playbook.org },
    {
      where: [
        { column: 'open', equals: true },
        { column: 'server', equals: connection },
      ],
      orderBy: ['due_at'],
      order: 'desc',
      limit: wakeBounds.conversations,
    },
  );
}

function rowNamed({ ledger }: WakeParts, address: ProjectedAddress, key: string) {
  return ledger.readProjectedRows(conversationsName, address, {
    where: [{ column: 'row_key', equals: key }],
    orderBy: ['row_key'],
    order: 'asc',
    limit: 1,
  });
}

interface NamedRow {
  readonly address: ProjectedAddress;
  readonly key: string;
}

function rowsNamedBy(requests: readonly ProjectedKeyedRow[]): readonly NamedRow[] {
  const named = requests.flatMap((request) => {
    const key = requestRowFrom(request.row).conversation;
    return key === null ? [] : [{ address: { org: request.org }, key }];
  });
  return [...new Map(named.map((row: NamedRow) => [JSON.stringify(row), row])).values()];
}

function rowsOfTheConversation(parts: WakeParts, playbook: PlaybookAddress, conversation: string) {
  const requests = parts.ledger.readProjectedRows(openRequestsName, everyDefinitionOf(playbook), {
    where: [
      { column: 'open', equals: true },
      { column: 'sent_conversation', equals: conversation },
    ],
    orderBy: ['requested_at'],
    order: 'asc',
    limit: wakeBounds.conversations,
  });
  return Effect.flatMap(requests, (rows) =>
    Effect.map(
      Effect.forEach(rowsNamedBy(rows), ({ address, key }) => rowNamed(parts, address, key)),
      (named: readonly (readonly ProjectedKeyedRow[])[]) => named.flat(),
    ),
  );
}

function rowsWoken(parts: WakeParts, woken: WokenConnection) {
  return woken.conversation === undefined
    ? rowsOfTheConnection(parts, woken)
    : rowsOfTheConversation(parts, woken.playbook, woken.conversation);
}

function broughtForward(parts: WakeParts, waiting: Waiting, now: number) {
  return Effect.gen(function* () {
    const [oldest] = (yield* openInConversation(parts, waiting)).kept;
    if (oldest === undefined) {
      return;
    }
    const route = routeOfRequest(oldest);
    const floorMs = readFloorMsOf(route.replies, route.telling.readLimit);
    const dueAt = now + floorMs;
    if (dueAt < waiting.dueAt && dueAt + floorMs <= waiting.nextReadAt) {
      yield* parts.ledger.advanceRow(conversationsName, waiting.address, waiting.key, {
        set: { due_at: dueAt },
        when: [
          { column: 'open', equals: true },
          { column: 'next_read_at', equals: waiting.nextReadAt },
          { column: 'due_at', after: dueAt },
        ],
      });
    }
  });
}

export function connectionWake(parts: WakeParts): ConnectionWake {
  return (woken, now) =>
    Effect.flatMap(rowsWoken(parts, woken), (rows) =>
      Effect.forEach(
        rows.flatMap((kept) => waitingIn(kept, woken.connection)),
        (waiting) => broughtForward(parts, waiting, now),
        { discard: true },
      ),
    );
}
