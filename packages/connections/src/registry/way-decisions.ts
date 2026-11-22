import { Conflict, InvalidInput, type Forbidden, type NotFound } from '@on.auto/operations';
import {
  accountTypeIssueOf,
  accountTypeWhereNoneIsGiven,
  accountTypesOf,
  isTheWayAsked,
  providerFoundBy,
  type AccountType,
  type Permissions,
  type ProviderList,
} from '@on.auto/providers';
import { Result } from 'effect';

import { decideAccountType } from './account-type-decisions.ts';
import type { AccountTypeSetting, CommandMetadata, WayChoice } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { linkedConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Forbidden | Conflict | InvalidInput>;

interface ActingWay {
  readonly kind: string;
  readonly permissions?: Permissions | undefined;
}

export interface OfferedWay extends ActingWay {
  readonly account_types?: readonly AccountType[] | undefined;
}

export interface WayAsked {
  readonly credential: ActingWay;
  readonly account_type?: AccountType | undefined;
}

type Connection = KeptConnection['connection'];

const actsAsNoAccount =
  'Expected no account_type: a connection made this way acts as the app or sends no credential, so it acts as no account.';

function waysOfferedFor(
  { connection, ways }: Pick<KeptConnection, 'connection' | 'ways'>,
  providers: ProviderList,
): readonly OfferedWay[] {
  const { provider, credential } = connection;
  if (provider !== null) {
    return providerFoundBy(providers, provider)?.entry.credentials ?? [];
  }
  return ways ?? [credential];
}

function wayNotOffered({ name, provider }: Pick<Connection, 'name' | 'provider'>): InvalidInput {
  return new InvalidInput({
    detail: `The connection ${name} cannot connect this way.`,
    issues: [
      {
        pointer: '/credential',
        detail:
          provider === null
            ? "Expected one of the ways the connection's server offers, as read_link lists them in ways."
            : `Expected one of the ways the provider ${provider} offers, as list_providers lists them.`,
      },
    ],
  });
}

function connectedAlready({ name, status }: Connection): Conflict {
  return new Conflict({
    detail: `The connection ${name} is ${status}, so how it connects can no longer be chosen. To connect it another way, remove it and add it again.`,
  });
}

function accountTypeIssueFor(given: AccountType | undefined, taken: readonly AccountType[]): string | undefined {
  if (given === undefined) {
    return undefined;
  }
  return taken.length === 0 ? actsAsNoAccount : accountTypeIssueOf(given, taken);
}

function untakenAccountType(name: string, issue: string): InvalidInput {
  return new InvalidInput({
    detail: `The connection ${name} cannot act as this account type when it connects this way.`,
    issues: [{ pointer: '/account_type', detail: issue }],
  });
}

export function wayChosenOf(
  kept: Pick<KeptConnection, 'connection' | 'ways'>,
  asked: WayAsked,
  providers: ProviderList,
): Result.Result<OfferedWay, Conflict | InvalidInput> {
  const { connection } = kept;
  if (connection.status !== 'pending') {
    return Result.fail(connectedAlready(connection));
  }
  const way = waysOfferedFor(kept, providers).find((offered) => isTheWayAsked(offered, asked.credential));
  if (way === undefined) {
    return Result.fail(wayNotOffered(connection));
  }
  const issue = accountTypeIssueFor(asked.account_type, accountTypesOf(way));
  return issue === undefined ? Result.succeed(way) : Result.fail(untakenAccountType(connection.name, issue));
}

function keptWithItsWay(connection: Connection, { account_type: given }: WayChoice): readonly ConnectionEvent[] {
  return given === undefined || given === connection.account_type
    ? []
    : [{ type: 'connection_account_type_set', data: { connection: connection.id, account_type: given } }];
}

function chosenAnotherWay(connection: Connection, command: WayChoice, way: OfferedWay): readonly ConnectionEvent[] {
  const { credential, says, account_type: given } = command;
  const accountType = given ?? accountTypeWhereNoneIsGiven(accountTypesOf(way));
  return [
    {
      type: 'connection_way_chosen',
      data: {
        connection: connection.id,
        credential,
        ...(accountType === undefined ? {} : { account_type: accountType }),
        says,
      },
    },
  ];
}

function decideWayChoice(command: WayChoice & CommandMetadata, registry: Registry, providers: ProviderList): Decision {
  return Result.flatMap(linkedConnectionOf(registry, command, command), (kept) =>
    Result.map(wayChosenOf(kept, command, providers), (way) =>
      isTheWayAsked(kept.connection.credential, way)
        ? keptWithItsWay(kept.connection, command)
        : chosenAnotherWay(kept.connection, command, way),
    ),
  );
}

export function decideOnItsWay(
  command: (AccountTypeSetting | WayChoice) & CommandMetadata,
  registry: Registry,
  providers: ProviderList,
): Decision {
  return command.type === 'set_account_type'
    ? decideAccountType(command, registry, providers)
    : decideWayChoice(command, registry, providers);
}
