import { Option, Schema } from 'effect';

import type { ListedRow, ProviderRows } from './provider-rows.ts';

export const modelsOfAGrant = ['AccessToken', 'AuthorizationCode', 'RefreshToken'] as const;

export function everyoneSignedOut(rows: Pick<ProviderRows, 'endedEvery'>): Promise<void> {
  return rows.endedEvery(['Session', 'Interaction', 'Grant', ...modelsOfAGrant]);
}

const modelsHeldByAnAccount = ['Session', 'Grant'] as const;

const accountOf = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ accountId: Schema.String })));

function isHeldBy({ payload }: ListedRow, accountId: string): boolean {
  return Option.exists(accountOf(payload), (held) => held.accountId === accountId);
}

export async function personSignedOut(
  rows: Pick<ProviderRows, 'listed' | 'destroyed'>,
  accountId: string,
): Promise<void> {
  await Promise.all(
    modelsHeldByAnAccount.map(async (model) => {
      const theirs = (await rows.listed(model)).filter((row) => isHeldBy(row, accountId));
      await Promise.all(theirs.map(({ sha256 }) => rows.destroyed({ model, sha256 })));
    }),
  );
}
