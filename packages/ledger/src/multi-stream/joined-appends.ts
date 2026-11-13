import { Schema } from 'effect';

import type { AppendingStore } from '../emmett/emmett-event-store.ts';
import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { CommitContext } from '../scrub/append-riders.ts';

interface JoinedTransactionOptions {
  readonly allowNestedTransactions: boolean;
}

const joinedTransactions: JoinedTransactionOptions = { allowNestedTransactions: true };

interface JoiningTransactions {
  withTransaction<A>(work: () => Promise<A>, options: JoinedTransactionOptions): Promise<A>;
  readonly execute: StatementExecutor;
}

type Committing = (messages: readonly unknown[]) => void;

type JoinedStoreOf = (committing: Committing) => AppendingStore;

export type TransactionsJoined = (
  work: (transactions: JoiningTransactions, joinedStore: JoinedStoreOf) => Promise<void>,
) => Promise<void>;

export type AppendsJoined = (appends: (joined: AppendingStore) => Promise<void>) => Promise<void>;

export type BeforeCommit = (messages: readonly unknown[], context: CommitContext) => Promise<void>;

export interface InlineHandling {
  readonly projection: {
    readonly canHandle: readonly string[];
    readonly handle: (
      messages: readonly unknown[],
      transaction: { readonly execute: StatementExecutor },
    ) => Promise<void>;
  };
}

interface KeptOnce {
  readonly registrations: readonly InlineHandling[];
  readonly beforeCommit: BeforeCommit;
}

const typeOf = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String }));

async function keptOnce(
  { registrations, beforeCommit }: KeptOnce,
  messages: readonly unknown[],
  execute: StatementExecutor,
): Promise<void> {
  await inTurn(registrations, async ({ projection }) => {
    const handled = messages.filter((message) => projection.canHandle.includes(typeOf(message).type));
    if (handled.length > 0) {
      await projection.handle(handled, { execute });
    }
  });
  await beforeCommit(messages, { transaction: { execute } });
}

export function appendsJoined(opened: TransactionsJoined, kept: KeptOnce): AppendsJoined {
  return (appends) =>
    opened((transactions, joinedStore) =>
      transactions.withTransaction(async () => {
        const committed: unknown[] = [];
        await appends(
          joinedStore((messages) => {
            committed.push(...messages);
          }),
        );
        await keptOnce(kept, committed, transactions.execute);
      }, joinedTransactions),
    );
}
