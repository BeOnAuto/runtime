import { InvalidInput, type Conflict, type NotFound } from '@on.auto/operations';
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
import type { AccountTypeSetting, CommandMetadata, ServiceAccountRecording, WayChoice } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { linkedConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';
import { decideServiceAccount } from './service-account-decisions.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Conflict | InvalidInput>;

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
  readonly placeholders?: Readonly<Record<string, string>> | undefined;
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
): Result.Result<OfferedWay, InvalidInput> {
  const { connection } = kept;
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

function valuesOf({ placeholders, base_url: baseUrl }: WayChoice) {
  return {
    ...(placeholders === undefined ? {} : { placeholders }),
    ...(baseUrl === undefined ? {} : { base_url: baseUrl }),
  };
}

function sameValues(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const named = Object.keys(left);
  return named.length === Object.keys(right).length && named.every((name) => right[name] === left[name]);
}

function holdsItsValues({ placeholders, entry }: Connection, { placeholders: given, base_url: baseUrl }: WayChoice) {
  return (
    (given === undefined || sameValues(placeholders ?? {}, given)) &&
    (baseUrl === undefined || baseUrl === (entry.base_url ?? null))
  );
}

type ChoiceRecorded = 'connection_way_chosen' | 'connection_next_way_chosen';

function wayChosen(
  connection: Connection,
  command: WayChoice,
  accountType: AccountType | undefined,
  type: ChoiceRecorded = 'connection_way_chosen',
): ConnectionEvent {
  const { credential, says } = command;
  return {
    type,
    data: {
      connection: connection.id,
      credential,
      ...(accountType === undefined ? {} : { account_type: accountType }),
      says,
      ...valuesOf(command),
    },
  };
}

function keptAccountTypeOf({ account_type: kept }: Connection, { account_type: given }: WayChoice) {
  return given ?? kept ?? undefined;
}

function chosenWhilePending(connection: Connection, command: WayChoice, way: OfferedWay) {
  if (!isTheWayAsked(connection.credential, way)) {
    return [wayChosen(connection, command, command.account_type ?? accountTypeWhereNoneIsGiven(accountTypesOf(way)))];
  }
  return holdsItsValues(connection, command)
    ? keptWithItsWay(connection, command)
    : [wayChosen(connection, command, keptAccountTypeOf(connection, command))];
}

function chosenForItsNextConnecting(connection: Connection, command: WayChoice, way: OfferedWay) {
  const next = 'connection_next_way_chosen';
  if (!isTheWayAsked(connection.credential, way)) {
    const accountType = command.account_type ?? accountTypeWhereNoneIsGiven(accountTypesOf(way));
    return [wayChosen(connection, command, accountType, next)];
  }
  const accountType = keptAccountTypeOf(connection, command);
  if (!holdsItsValues(connection, command)) {
    return [wayChosen(connection, command, accountType, next)];
  }
  return accountType === (connection.account_type ?? undefined)
    ? []
    : [wayChosen(connection, { ...command, credential: connection.credential }, accountType, next)];
}

function decideWayChoice(command: WayChoice & CommandMetadata, registry: Registry, providers: ProviderList): Decision {
  return Result.flatMap(linkedConnectionOf(registry, command), (kept) =>
    Result.map(wayChosenOf(kept, command, providers), (way): readonly ConnectionEvent[] =>
      kept.connection.status === 'pending'
        ? chosenWhilePending(kept.connection, command, way)
        : chosenForItsNextConnecting(kept.connection, command, way),
    ),
  );
}

export function decideOnItsWay(
  command: (AccountTypeSetting | WayChoice | ServiceAccountRecording) & CommandMetadata,
  registry: Registry,
  providers: ProviderList,
): Decision {
  if (command.type === 'record_service_account') {
    return decideServiceAccount(command, registry);
  }
  return command.type === 'set_account_type'
    ? decideAccountType(command, registry, providers)
    : decideWayChoice(command, registry, providers);
}
