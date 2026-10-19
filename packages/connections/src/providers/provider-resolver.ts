import type { Issue } from '@on.auto/operations';
import { additionOfProvider, providerNamed, type ProviderAddition, type ProviderList } from '@on.auto/providers';
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

function placedWhereTheWayGoes(addition: ProviderAddition): Result.Result<ProviderAddition, readonly Issue[]> {
  const issues = credentialIssuesOf(addition.credential, addition.type, addition.entry);
  return issues.length === 0
    ? Result.succeed(addition)
    : Result.fail(issues.map(({ detail }) => ({ pointer: theProvider, detail })));
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
  return ({ provider, placeholders, credential }: ProviderNamed) =>
    Result.flatMap(providerNamed(providers, provider), ({ entry }) =>
      Result.flatMap(
        Result.flatMap(additionOfProvider(entry, { placeholders, kind: credential.kind }), placedWhereTheWayGoes),
        (addition) =>
          Result.map(credentialledOf(addition.credential, credential), (credentialled) =>
            resolvedOf(addition, credentialled, providers.documents),
          ),
      ),
    );
}
