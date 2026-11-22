import { Conflict, InvalidInput, type NotFound } from '@on.auto/operations';
import { accountTypeIssueOf, type ProviderList } from '@on.auto/providers';
import { Result } from 'effect';

import type { AccountTypeSetting } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { keptConnectionOf } from './registry-lookup.ts';
import type { Registry } from './registry.ts';
import { accountTypesTakenBy } from './what-connections-act-as.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Conflict | InvalidInput>;

const accountTypePointer = '/account_type';

function removedRefusal(name: string): Conflict {
  return new Conflict({ detail: `The connection ${name} is removed, so its account type cannot be set.` });
}

function actsAsNoAccount(name: string): Conflict {
  return new Conflict({
    detail: `The connection ${name} acts as the app or sends no credential, so it has no account type.`,
  });
}

function notTaken(name: string, issue: string): InvalidInput {
  return new InvalidInput({
    detail: `The connection ${name} cannot be marked with this account type.`,
    issues: [{ pointer: accountTypePointer, detail: issue }],
  });
}

export function decideAccountType(
  { connection, account_type: accountType }: AccountTypeSetting,
  registry: Registry,
  providers: ProviderList,
): Decision {
  return Result.flatMap(keptConnectionOf(registry, connection), ({ connection: kept }): Decision => {
    if (kept.status === 'removed') {
      return Result.fail(removedRefusal(kept.name));
    }
    const taken = accountTypesTakenBy(kept, providers);
    if (taken.length === 0) {
      return Result.fail(actsAsNoAccount(kept.name));
    }
    const issue = accountTypeIssueOf(accountType, taken);
    if (issue !== undefined) {
      return Result.fail(notTaken(kept.name, issue));
    }
    return kept.account_type === accountType
      ? Result.succeed([])
      : Result.succeed([{ type: 'connection_account_type_set', data: { connection, account_type: accountType } }]);
  });
}
