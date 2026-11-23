import {
  addressOfTheRow,
  everyDefinitionOf,
  playbookRowsOf,
  type PlaybookAddress,
  type ProjectedAddress,
  type ProjectedKeyedRow,
  type ProjectionAdvancer,
  type ProjectionReader,
} from '@on.auto/operations';
import { wokenReadAt } from '@on.auto/tool-servers';
import { Effect } from 'effect';

import { readFloorMsOf } from '../conversations/cadence.ts';
import { conversationRowFrom, conversationsName } from '../conversations/conversation-rows.ts';
import { openInConversation } from '../conversations/open-in-conversation.ts';
import { readsInATurn } from '../readings/turn-readings.ts';
import { routeOfRequest } from '../replies/request-routes.ts';
import { openRequestsName } from '../requests/open-requests.ts';
import { requestRowFrom } from '../requests/request-rows.ts';

export interface WokenConnection {
  readonly org: string;
  readonly playbook?: string;
  readonly connection: string;
  readonly conversation?: string;
}

export type ConnectionWake = (woken: WokenConnection, now: number) => Effect.Effect<void>;

interface ReadParts {
  readonly ledger: Pick<ProjectionReader, 'readProjectedRows'>;
}

export interface WakeParts extends ReadParts {
  readonly ledger: Pick<ProjectionReader, 'readProjectedRows'> & ProjectionAdvancer;
}

const wakeBounds = { conversations: 100 } as const;

interface Waiting {
  readonly address: ProjectedAddress;
  readonly key: string;
  readonly dueAt: number;
  readonly nextReadAt: number;
  readonly activeAt: number;
}

function waitingIn(kept: ProjectedKeyedRow, connection: string): readonly Waiting[] {
  const row = conversationRowFrom(kept.row);
  const { due_at: dueAt, next_read_at: nextReadAt, active_at: activeAt } = row;
  const readThrough = row.open && row.server === connection && row.waited_after === null;
  return readThrough && dueAt !== null && nextReadAt !== null
    ? [{ address: addressOfTheRow(kept), key: kept.key, dueAt, nextReadAt, activeAt }]
    : [];
}

function rowsOfTheConnection({ ledger }: WakeParts, { org, connection }: WokenConnection) {
  return ledger.readProjectedRows(
    conversationsName,
    { org },
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

function requestsOpenIn({ ledger }: ReadParts, org: string, conversation: string) {
  return ledger.readProjectedRows(openRequestsName, everyDefinitionOf({ org }), {
    where: [
      { column: 'open', equals: true },
      { column: 'sent_conversation', equals: conversation },
    ],
    orderBy: ['requested_at'],
    order: 'asc',
    limit: wakeBounds.conversations,
  });
}

function rowsOfTheConversation(parts: WakeParts, org: string, conversation: string) {
  const requests = requestsOpenIn(parts, org, conversation);
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
    : rowsOfTheConversation(parts, woken.org, woken.conversation);
}

interface Paced {
  readonly waiting: Waiting;
  readonly floorMs: number;
  readonly reads: number;
}

function pacedOf(parts: WakeParts, waiting: Waiting): Effect.Effect<readonly Paced[]> {
  return Effect.map(openInConversation(parts, waiting), ({ kept }): readonly Paced[] => {
    const [oldest] = kept;
    if (oldest === undefined) {
      return [];
    }
    const route = routeOfRequest(oldest);
    return [{ waiting, floorMs: readFloorMsOf(route.replies, route.telling.readLimit), reads: readsInATurn(kept) }];
  });
}

function readsAskedBy(woken: WokenConnection, paced: readonly Paced[]): number {
  return woken.conversation === undefined ? paced.reduce((asked, { reads }) => asked + reads, 0) : 1;
}

function broughtForward(parts: WakeParts, { waiting, floorMs }: Paced, dueAt: number): Effect.Effect<void> {
  return dueAt < waiting.dueAt && dueAt + floorMs <= waiting.nextReadAt
    ? parts.ledger.advanceRow(conversationsName, waiting.address, waiting.key, {
        set: { due_at: dueAt },
        when: [
          { column: 'open', equals: true },
          { column: 'next_read_at', equals: waiting.nextReadAt },
          { column: 'due_at', after: dueAt },
        ],
      })
    : Effect.void;
}

export type PlaybooksWaiting = (org: string, conversation: string) => Effect.Effect<readonly PlaybookAddress[]>;

function eachOnce(playbooks: readonly PlaybookAddress[]): readonly PlaybookAddress[] {
  return [
    ...new Map(playbooks.map((playbook) => [JSON.stringify([playbook.org, playbook.playbook]), playbook])).values(),
  ];
}

export function playbooksWaitingIn(parts: ReadParts): PlaybooksWaiting {
  return (org, conversation) =>
    Effect.map(requestsOpenIn(parts, org, conversation), (rows) =>
      eachOnce(playbookRowsOf(openRequestsName, rows).map(({ playbook }) => ({ org, playbook }))),
    );
}

export function connectionWake(parts: WakeParts): ConnectionWake {
  return (woken, now) =>
    Effect.gen(function* () {
      const rows = yield* rowsWoken(parts, woken);
      const waiting = rows.flatMap((kept) => waitingIn(kept, woken.connection));
      const paced = (yield* Effect.forEach(waiting, (each) => pacedOf(parts, each))).flat();
      const reads = readsAskedBy(woken, paced);
      yield* Effect.forEach(
        paced,
        (each) =>
          broughtForward(
            parts,
            each,
            wokenReadAt({ now, floorMs: each.floorMs, reads, anchor: each.waiting.activeAt }),
          ),
        { discard: true },
      );
    });
}
