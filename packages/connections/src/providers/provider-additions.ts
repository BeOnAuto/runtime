import type { Conflict, Forbidden, InvalidInput, Issue } from '@on.auto/operations';
import {
  additionOfProvider,
  documentServerOf,
  providerNamed,
  type Provider,
  type ProviderList,
} from '@on.auto/providers';
import { Option, Result, type Redacted } from 'effect';

import {
  additionIssuesOf,
  conflictAsTakenByTheFile,
  invalidAddition,
  type AdditionInput,
  type EntryChecking,
} from '../entries/entry-checks.ts';
import type { AdditionGiven } from '../operations/connection-fields.ts';
import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import { policyRefusalOf } from '../policy/policy-rules.ts';
import { credentialFieldIssuesOf } from '../registry/credential.ts';
import type { Providing } from '../serving/placed-credentials.ts';

export interface GivenAddition extends AdditionInput {
  readonly placeholders: Readonly<Record<string, string>> | null;
}

type Checking = Omit<EntryChecking, 'providing'>;

const theProvider = '/provider';

const whereProvidersAreListed = 'search lists the providers a person may connect';

const writtenByTheCaller: readonly string[] = ['/entry/playbooks', '/entry/allowed', '/entry/record_content'];

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

function givenByHand(given: AdditionGiven): GivenAddition {
  return {
    name: required(given.name),
    type: required(given.type),
    provider: null,
    placeholders: null,
    entry: required(given.entry),
    credential: required(given.credential),
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
  providers: ProviderList,
): Result.Result<GivenAddition, readonly Issue[]> {
  const { name, placeholders, entry = {}, credential } = given;
  return Result.flatMap(namedHere(providers, provider), ({ entry: written }) =>
    additionOfProvider(written, {
      name,
      placeholders,
      kind: credential?.kind,
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

function providerIssuesOf(addition: GivenAddition, given: AdditionGiven, checking: EntryChecking): readonly Issue[] {
  const credential = credentialFieldIssuesOf(addition.credential).map(({ path, issue }): Issue => ({
    pointer: `/credential/${path.join('/')}`,
    detail: issue,
  }));
  return placedIssuesOf(credential.length > 0 ? credential : additionIssuesOf(addition, checking), given);
}

function issuesOf(addition: GivenAddition, given: AdditionGiven, checking: EntryChecking): readonly Issue[] {
  return addition.provider === null
    ? additionIssuesOf(addition, checking)
    : providerIssuesOf(addition, given, checking);
}

export function checkedAdditionOf(
  given: AdditionGiven,
  checking: Checking,
  services: ProviderServices,
): Result.Result<GivenAddition, InvalidInput> {
  const resolved =
    given.provider === undefined
      ? Result.succeed(givenByHand(given))
      : givenToProvider(given.provider, given, services.providers);
  return Result.flatMap(Result.mapError(resolved, invalidAddition), (addition) => {
    const issues = issuesOf(addition, given, { ...checking, providing: providingOf(addition, services) });
    return issues.length > 0 ? Result.fail(invalidAddition(issues)) : Result.succeed(addition);
  });
}

export function refusalOfTheAddition(
  addition: GivenAddition,
  policy: ConnectionPolicy,
  fileEntries: readonly string[],
  services: ProviderServices,
): Forbidden | Conflict | undefined {
  return (
    policyRefusalOf(policy, addition, providingOf(addition, services)?.documentServer) ??
    (fileEntries.includes(addition.name) ? conflictAsTakenByTheFile(addition.name) : undefined)
  );
}
