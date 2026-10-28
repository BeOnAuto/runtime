import { required } from '@on.auto/operations';
import type { Conflict, Forbidden, InvalidInput, Issue } from '@on.auto/operations';
import {
  additionOfProvider,
  documentServerOf,
  providerNamed,
  type Provider,
  type ProviderList,
} from '@on.auto/providers';
import { Effect, Result, type Redacted } from 'effect';

import {
  additionIssuesOf,
  conflictAsTakenByTheFile,
  invalidAddition,
  type AdditionInput,
  type EntryChecking,
} from '../entries/entry-checks.ts';
import type { AdditionGiven } from '../operations/connection-fields.ts';
import { policyRefusalOf } from '../policy/policy-rules.ts';
import { credentialFieldIssuesOf } from '../registry/credential.ts';
import type { Credential } from '../registry/credential.ts';
import type { Providing } from '../serving/placed-credentials.ts';
import { consentUnsetUp, isConsentUnsetUp } from './consent-offered.ts';
import { isOfferedWay, type Listing } from './provider-listing.ts';

export interface GivenAddition extends AdditionInput {
  readonly placeholders: Readonly<Record<string, string>> | null;
  readonly says?: Readonly<Record<string, string>>;
}

type Checking = Omit<EntryChecking, 'providing'>;

const theProvider = '/provider';

const whereProvidersAreListed = 'search lists the providers a person may connect';

const writtenByTheCaller: readonly string[] = ['/entry/playbooks', '/entry/allowed', '/entry/record_content'];

const namedByTheServer: Credential = { kind: 'authorization' };

function givenByHand(given: AdditionGiven): GivenAddition {
  return {
    name: required(given.name),
    type: required(given.type),
    provider: null,
    placeholders: null,
    entry: required(given.entry),
    credential: given.credential ?? namedByTheServer,
  };
}

function namedHere(providers: ProviderList, provider: string): Result.Result<Provider, readonly Issue[]> {
  return Result.mapError(providerNamed(providers, provider), (issues) =>
    issues.map(({ pointer, detail }): Issue => ({ pointer, detail: `${detail}; ${whereProvidersAreListed}` })),
  );
}

function givenToProvider(
  provider: string,
  given: AdditionGiven,
  listing: Listing,
): Result.Result<GivenAddition, readonly Issue[]> {
  const { name, placeholders, entry = {}, credential } = given;
  return Result.flatMap(namedHere(listing.providers, provider), (named) =>
    additionOfProvider(named.entry, {
      name,
      placeholders,
      kind: credential?.kind,
      canBeGiven: (way) => isOfferedWay(named, way, listing),
      playbooks: entry.playbooks,
      allowed: entry.allowed,
      record_content: entry.record_content,
    }),
  );
}

export interface ProviderServices {
  readonly providers: ProviderList;
  readonly providerValues: ReadonlyMap<string, Redacted.Redacted>;
}

type AdditionServices = ProviderServices & Listing;

type Consent = Listing['consent'];

interface ClientListing {
  readonly hadSources: (studioBase: string) => Effect.Effect<Consent>;
}

type ListingServices = Omit<AdditionServices, 'consent'> & { readonly consent: ClientListing } & {
  readonly studioBase: string;
};

export function providingOf(
  { provider }: Pick<AdditionInput, 'provider'>,
  { providers, providerValues }: ProviderServices,
): Providing | undefined {
  if (provider === null) {
    return undefined;
  }
  const documentServer = Result.getOrUndefined(Result.map(providerNamed(providers, provider), documentServerOf));
  return { documents: providers.documents, values: providerValues, documentServer };
}

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
  readonly consent: Consent;
}

function consentIssuesOf({ provider, credential }: GivenAddition, consent: Consent): readonly Issue[] {
  return isConsentUnsetUp(credential, consent)
    ? [{ pointer: '/credential/kind', detail: consentUnsetUp(String(provider)) }]
    : [];
}

function providerIssuesOf(addition: GivenAddition, { given, checking, consent }: Checked): readonly Issue[] {
  const credential = credentialFieldIssuesOf(addition.credential).map(({ path, issue }): Issue => ({
    pointer: `/credential/${path.join('/')}`,
    detail: issue,
  }));
  if (credential.length > 0) {
    return placedIssuesOf(credential, given);
  }
  const unsetUp = consentIssuesOf(addition, consent);
  return unsetUp.length > 0 ? unsetUp : placedIssuesOf(additionIssuesOf(addition, checking), given);
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
    const issues = issuesOf(addition, { given, checking: { ...checking, providing }, consent: services.consent });
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

export function refusalOfTheAddition(
  addition: GivenAddition,
  policy: Listing['policy'],
  fileEntries: readonly string[],
  services: ProviderServices,
): Forbidden | Conflict | undefined {
  return (
    policyRefusalOf(policy, addition, providingOf(addition, services)?.documentServer) ??
    (fileEntries.includes(addition.name) ? conflictAsTakenByTheFile(addition.name) : undefined)
  );
}
