import type { Conflict, Forbidden, InvalidInput, Issue } from '@on.auto/operations';
import {
  accountTypeWhereNoneIsGiven,
  accountTypesOf,
  additionOfProvider,
  permissionsOf,
  providerNamed,
  type AccountType,
  type Permissions,
  type Provider,
  type ProviderList,
  type EventsByHand,
} from '@on.auto/providers';
import { Effect, Option, Result } from 'effect';

import {
  additionIssuesOf,
  conflictAsTakenByTheFile,
  invalidAddition,
  type AdditionInput,
  type EntryChecking,
} from '../entries/entry-checks.ts';
import type { AdditionGiven } from '../operations/connection-fields.ts';
import { gatewayRefusalOf, policyRefusalOf } from '../policy/policy-rules.ts';
import { credentialFieldIssuesOf } from '../registry/credential.ts';
import type { Credential } from '../registry/credential.ts';
import { replacedOf, replacedWayWords } from '../replacements/replaced-providers.ts';
import {
  gatewayOriginsOf,
  gatewayUnofferedOf,
  isOfferedWay,
  oauthClientForOf,
  waysInOrderOf,
  type Listing,
} from './provider-listing.ts';
import { providingOf, type ProviderServices } from './provider-providing.ts';

export interface GivenWay extends Credential {
  readonly permissions?: Permissions;
}

export interface GivenAddition extends AdditionInput {
  readonly placeholders: Readonly<Record<string, string>> | null;
  readonly says?: Readonly<Record<string, string>>;
  readonly events?: EventsByHand;
  readonly account_type?: AccountType;
  readonly ways?: readonly GivenWay[];
}

type Checking = Omit<EntryChecking, 'providing'>;

const theProvider = '/provider';

const whereProvidersAreListed = 'search lists the providers a person may connect';

const writtenByTheCaller: readonly string[] = ['/entry/playbooks', '/entry/allowed', '/entry/record_content'];

const namedByTheServer: Credential = { kind: 'authorization' };

function withItsAccountType(addition: GivenAddition, taken: readonly AccountType[]): GivenAddition {
  const accountType = accountTypeWhereNoneIsGiven(taken);
  return accountType === undefined ? addition : { ...addition, account_type: accountType };
}

export function actingAsItsKind(credential: Credential): GivenWay {
  const permissions = permissionsOf(credential);
  return { ...credential, ...(permissions === undefined ? {} : { permissions }) };
}

function givenByHand(given: AdditionGiven): GivenAddition {
  const { document_text: documentText, ...entry } = Option.getOrThrow(Option.fromNullishOr(given.entry));
  const { events } = given;
  const credential = given.credential ?? namedByTheServer;
  const addition = {
    name: Option.getOrThrow(Option.fromNullishOr(given.name)),
    type: Option.getOrThrow(Option.fromNullishOr(given.type)),
    provider: null,
    placeholders: null,
    entry,
    ...(documentText === undefined ? {} : { documentText }),
    credential: actingAsItsKind(credential),
    ...(events === undefined ? {} : { events }),
  };
  return withItsAccountType(addition, accountTypesOf(credential));
}

function namedHere(providers: ProviderList, provider: string): Result.Result<Provider, readonly Issue[]> {
  return Result.mapError(providerNamed(providers, provider), (issues) =>
    issues.map(({ pointer, detail }): Issue => ({ pointer, detail: `${detail}; ${whereProvidersAreListed}` })),
  );
}

function unofferedGatewayOf(named: Provider, addition: GivenAddition, listing: Listing): readonly Issue[] {
  const because = addition.credential.client_source === 'gateway' ? gatewayUnofferedOf(named, listing) : undefined;
  return because === undefined ? [] : [{ pointer: theProvider, detail: because }];
}

function unreplaced(named: Provider, { providers }: Listing): Result.Result<Provider, readonly Issue[]> {
  const replaced = replacedOf(providers, named.entry.name);
  return replaced === undefined
    ? Result.succeed(named)
    : Result.fail([{ pointer: theProvider, detail: replacedWayWords(replaced) }]);
}

function givenToProvider(
  provider: string,
  given: AdditionGiven,
  listing: Listing,
): Result.Result<GivenAddition, readonly Issue[]> {
  const { name, placeholders, entry = {}, credential } = given;
  const offeredHere = Result.flatMap(namedHere(listing.providers, provider), (named) => unreplaced(named, listing));
  return Result.flatMap(offeredHere, (named) =>
    Result.flatMap(
      additionOfProvider(
        { ...named.entry, credentials: waysInOrderOf(named, listing) },
        {
          name,
          placeholders,
          kind: credential?.kind,
          oauthClientFor: oauthClientForOf(named, listing, credential?.oauth_client),
          canBeGiven: (way) => isOfferedWay(named, way, listing),
          playbooks: entry.playbooks,
          allowed: entry.allowed,
          record_content: entry.record_content,
        },
      ),
      ({ account_types: accountTypes, permissions, ...addition }) => {
        const unoffered = unofferedGatewayOf(named, addition, listing);
        const acting = { ...addition.credential, ...(permissions === undefined ? {} : { permissions }) };
        return unoffered.length === 0
          ? Result.succeed(withItsAccountType({ ...addition, credential: acting }, accountTypes))
          : Result.fail(unoffered);
      },
    ),
  );
}

type AdditionServices = ProviderServices & Listing;

type Consent = Listing['consent'];

interface ClientListing {
  readonly hadSources: (studioBase: string) => Effect.Effect<Consent>;
}

type ListingServices = Omit<AdditionServices, 'consent'> & { readonly consent: ClientListing } & {
  readonly studioBase: string;
};

function isWrittenBy(pointer: string, written: string): boolean {
  return pointer === written || pointer.startsWith(`${written}/`);
}

function placedPointerOf(pointer: string, given: AdditionGiven): string {
  if (isWrittenBy(pointer, '/name')) {
    return given.name === undefined ? theProvider : pointer;
  }
  return writtenByTheCaller.some((written) => isWrittenBy(pointer, written)) ? pointer : theProvider;
}

function placedIssuesOf(issues: readonly Issue[], given: AdditionGiven): readonly Issue[] {
  const placed = issues.map(({ pointer, detail }): Issue => ({ pointer: placedPointerOf(pointer, given), detail }));
  return [
    ...new Map(placed.map((issue): readonly [string, Issue] => [`${issue.pointer} ${issue.detail}`, issue])).values(),
  ];
}

interface Checked {
  readonly given: AdditionGiven;
  readonly checking: EntryChecking;
}

function providerIssuesOf(addition: GivenAddition, { given, checking }: Checked): readonly Issue[] {
  const credential = credentialFieldIssuesOf(addition.credential).map(({ path, issue }): Issue => ({
    pointer: `/credential/${path.join('/')}`,
    detail: issue,
  }));
  return placedIssuesOf(credential.length > 0 ? credential : additionIssuesOf(addition, checking), given);
}

function issuesOf(addition: GivenAddition, checked: Checked): readonly Issue[] {
  return addition.provider === null
    ? additionIssuesOf(addition, checked.checking)
    : providerIssuesOf(addition, checked);
}

function additionCheckedWith(
  given: AdditionGiven,
  checking: Checking,
  services: AdditionServices,
): Result.Result<GivenAddition, InvalidInput> {
  const resolved =
    given.provider === undefined
      ? Result.succeed(givenByHand(given))
      : givenToProvider(given.provider, given, services);
  return Result.flatMap(Result.mapError(resolved, invalidAddition), (addition) => {
    const providing = providingOf(addition, services);
    const issues = issuesOf(addition, { given, checking: { ...checking, providing } });
    return issues.length > 0 ? Result.fail(invalidAddition(issues)) : Result.succeed(addition);
  });
}

export function checkedAdditionOf(
  given: AdditionGiven,
  checking: Checking,
  services: ListingServices,
): Effect.Effect<GivenAddition, InvalidInput> {
  return Effect.flatMap(services.consent.hadSources(services.studioBase), (consent) =>
    Effect.fromResult(additionCheckedWith(given, checking, { ...services, consent })),
  );
}

export function gatewayRefusalOfTheAddition(
  addition: GivenAddition,
  { providers }: Pick<ProviderServices, 'providers'>,
): Forbidden | undefined {
  return gatewayRefusalOf(addition, gatewayOriginsOf(providers));
}

export function refusalOfTheAddition(
  addition: GivenAddition,
  policy: Listing['policy'],
  fileEntries: readonly string[],
  services: ProviderServices,
): Forbidden | Conflict | undefined {
  return (
    policyRefusalOf(policy, addition, providingOf(addition, services)) ??
    gatewayRefusalOfTheAddition(addition, services) ??
    (fileEntries.includes(addition.name) ? conflictAsTakenByTheFile(addition.name) : undefined)
  );
}
