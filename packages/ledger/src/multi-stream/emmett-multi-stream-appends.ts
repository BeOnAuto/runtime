import { DumboError, UniqueConstraintError } from '@event-driven-io/dumbo';
import type { ContentHolders } from '@on.auto/operations';

import {
  announcerOf,
  appendedTo,
  asAVersionConflict,
  heldAsMeasured,
  messagesOf,
  type AppendingStore,
  type StoredData,
} from '../emmett/emmett-event-store.ts';
import type { AppendListeners } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { VersionConflict } from '../version-conflict.ts';
import { appendsJoined, type BeforeCommit, type InlineHandling, type TransactionsJoined } from './joined-appends.ts';
import { requestsInOrder, type AppendStreamRequest, type MultiStreamAppends } from './multi-stream-appends.ts';

interface MultiStreamAppending<Stored extends Record<string, unknown>> {
  readonly data: StoredData<Stored>;
  readonly mostEventsInOneAppend: number;
  readonly holders?: ContentHolders | undefined;
  readonly listeners: AppendListeners;
  readonly beforeCommit: BeforeCommit;
}

export type MultiStreamAppendsOver = <Stored extends Record<string, unknown>>(
  opened: TransactionsJoined,
  appending: MultiStreamAppending<Stored>,
) => MultiStreamAppends;

type StreamAppended = (store: AppendingStore) => Promise<void>;

type AppendedOf = (request: AppendStreamRequest) => StreamAppended;

function appendedOf<Stored extends Record<string, unknown>>({
  data,
  holders = new Map(),
}: MultiStreamAppending<Stored>): AppendedOf {
  return ({ stream, events, place }) => {
    const messages = messagesOf(data, stream, heldAsMeasured(holders, stream, events), place);
    return (store) => appendedTo(store, stream, messages, place);
  };
}

function isADuplicateRow(error: unknown): boolean {
  return DumboError.isInstanceOf(error, { errorType: UniqueConstraintError.ErrorType });
}

function asAConflictOfTheJoinedTransaction(error: unknown): unknown {
  return isADuplicateRow(error) ? new VersionConflict() : asAVersionConflict(error);
}

export function multiStreamAppendsOf(registrations: readonly InlineHandling[]): MultiStreamAppendsOver {
  return (opened, appending) => {
    const announced = announcerOf(appending.listeners);
    const appended = appendedOf(appending);
    const joined = appendsJoined(opened, { registrations, beforeCommit: appending.beforeCommit });
    return {
      multiStreamAppend: async (requests) => {
        const ordered = requestsInOrder(requests, appending.mostEventsInOneAppend);
        const appends = ordered.map((request) => appended(request));
        try {
          await joined((store) => inTurn(appends, (append) => append(store)));
        } catch (error) {
          throw asAConflictOfTheJoinedTransaction(error);
        }
        for (const { stream, events, place } of ordered) {
          announced(stream, events, place);
        }
      },
    };
  };
}
