import { alternatives, type Issue } from '@on.auto/operations';
import {
  additionOfProvider,
  providerNamed,
  type ProviderAddition,
  type ProviderEntry,
  type ProviderList,
} from '@on.auto/providers';
import type { CredentialGiven, ProviderNamed, ProviderResolved, ProviderResolver } from '@on.auto/tool-servers';
import { Result } from 'effect';

import { credentialIssuesOf } from '../entries/credential-checks.ts';
import { givenFieldsOf, wordsOfTheSettings } from '../entries/given-values.ts';
import type { Credential } from '../registry/credential.ts';
import { placedReference, type NamedReference, type Placing } from '../serving/placed-credentials.ts';

interface Credentialled {
  readonly credential: Credential;
  readonly reference: NamedReference | undefined;
}

const takesNone = 'Expected no credential: the way none takes none';

const theProvider = '/provider';

const byConsent = 'authorization';

function underTheCredential(issues: readonly Issue[]): readonly Issue[] {
  return issues.map(({ pointer, detail }) => ({ pointer: `/credential${pointer}`, detail }));
}

function credentialledOf(
  credential: Credential,
  { kind: _kind, ...fields }: CredentialGiven,
): Result.Result<Credentialled, readonly Issue[]> {
  if (credential.kind === 'none') {
    return Object.values(fields).every((field) => field === undefined)
      ? Result.succeed({ credential, reference: undefined })
      : Result.fail([{ pointer: '/credential', detail: takesNone }]);
  }
  return Result.mapBoth(givenFieldsOf(credential, fields, wordsOfTheSettings), {
    onFailure: underTheCredential,
    onSuccess: ({ value, algorithm, clientId }): Credentialled => ({
      credential: clientId === undefined ? credential : { ...credential, client_id: clientId },
      reference: { variable: value, algorithm },
    }),
  });
}

function isGivenInTheSettings({ kind }: { readonly kind: string }): boolean {
  return kind !== byConsent;
}

function consentRefusalOf({ name, credentials }: ProviderEntry, { kind }: CredentialGiven): readonly Issue[] {
  const others = credentials.filter((way) => isGivenInTheSettings(way)).map((way) => way.kind);
  const detail =
    others.length === 0
      ? `The provider ${name} takes authorization alone, a consent a person gives on Studio's page, which an entry of the settings file cannot give, so a person connects it there`
      : `The provider ${name} takes no authorization credential in the settings file, since a person gives that consent on Studio's page; it takes ${alternatives(others)}`;
  return [{ pointer: kind === undefined ? '/credential' : '/credential/kind', detail }];
}

function placedWhereTheWayGoes(addition: ProviderAddition): Result.Result<ProviderAddition, readonly Issue[]> {
  const issues = credentialIssuesOf(addition.credential, addition.type, addition.entry);
  return issues.length === 0
    ? Result.succeed(addition)
    : Result.fail(issues.map(({ detail }) => ({ pointer: theProvider, detail })));
}

function additionOfTheSettings(
  entry: ProviderEntry,
  { placeholders, credential }: ProviderNamed,
): Result.Result<ProviderAddition, readonly Issue[]> {
  const added = additionOfProvider(entry, { placeholders, kind: credential.kind, canBeGiven: isGivenInTheSettings });
  return Result.flatMap(added, (addition) =>
    isGivenInTheSettings(addition.credential)
      ? placedWhereTheWayGoes(addition)
      : Result.fail(consentRefusalOf(entry, credential)),
  );
}

function writtenAtOf({ placedAt }: Placing): (pointer: string) => string {
  const fieldsAt = new Map([...placedAt].map(([field, at]: readonly [string, string]) => [at, field]));
  return (pointer) => {
    const field = fieldsAt.get(pointer);
    return field === undefined ? theProvider : `/credential/${field}`;
  };
}

function resolvedOf(addition: ProviderAddition, { credential, reference }: Credentialled, documents: string) {
  const placing = placedReference({ provider: addition.provider, entry: addition.entry, credential }, reference);
  const resolved: ProviderResolved = {
    written: { ...placing.written, type: addition.type },
    placedValues: placing.placedValues,
    documentsDirectory: documents,
    writtenAt: writtenAtOf(placing),
  };
  return resolved;
}

export function makeProviderResolver(providers: ProviderList): ProviderResolver {
  return (named: ProviderNamed) =>
    Result.flatMap(providerNamed(providers, named.provider), ({ entry }) =>
      Result.flatMap(additionOfTheSettings(entry, named), (addition) =>
        Result.map(credentialledOf(addition.credential, named.credential), (credentialled) =>
          resolvedOf(addition, credentialled, providers.documents),
        ),
      ),
    );
}
