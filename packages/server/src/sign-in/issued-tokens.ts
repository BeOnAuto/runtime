import { signedInPersonOf, type IdentityService, type Principal } from '@on.auto/identity';
import { defaultOrg, type PeopleRows } from '@on.auto/openid-connect';
import type { IssuedAccessToken, KeptSecrets, PersonClaims } from '@on.auto/openid-connect/authorization-server';
import { allPermissions, bytesOfReference, holdsNoForbiddenCharacter, mostReferenceBytes } from '@on.auto/operations';
import type { SecretStore } from '@on.auto/secrets';
import { Effect, Redacted } from 'effect';

import type { Enrolling } from './admission.ts';

function namingOf(text: string | undefined): string | null {
  return text !== undefined &&
    text !== '' &&
    bytesOfReference(text) <= mostReferenceBytes &&
    holdsNoForbiddenCharacter(text)
    ? text
    : null;
}

function metadataDocumentHostOf(clientId: string): string | null {
  const address = URL.parse(clientId);
  return address?.protocol === 'https:' ? address.host : null;
}

function principalOfTheToken({ accountId, clientId, clientName, scope, isStudios }: IssuedAccessToken): Principal {
  const granted = new Set(scope.split(' '));
  const client = { id: clientId, name: namingOf(clientName), domain: metadataDocumentHostOf(clientId) };
  return signedInPersonOf({
    subject: accountId,
    name: accountId,
    org: defaultOrg,
    permissions: allPermissions.filter((permission) => granted.has(permission)),
    ...(isStudios ? {} : { client }),
  });
}

export function identityServiceOf(
  publicUrl: string,
  accessTokenOf: (value: string) => Promise<IssuedAccessToken | undefined>,
): IdentityService {
  return {
    resource: { publicUrl, authorizationServers: [publicUrl] },
    personOf: async (token) => {
      const issued = await accessTokenOf(token);
      return issued === undefined ? { because: undefined } : principalOfTheToken(issued);
    },
  };
}

export function claimsIn(
  people: PeopleRows,
  roles: Pick<Enrolling, 'holdsARole'>,
): (accountId: string) => Promise<PersonClaims | undefined> {
  return async (accountId) => {
    const [person, holdsARole] = await Promise.all([people.found(accountId), roles.holdsARole(accountId)]);
    return person === undefined || !holdsARole
      ? undefined
      : {
          ...(person.name === undefined ? {} : { name: person.name }),
          ...(person.emailAddress === undefined ? {} : { email: person.emailAddress }),
        };
  };
}

export function keptSecretsOf(secrets: Pick<SecretStore, 'keep' | 'read' | 'forget'>): KeptSecrets {
  return {
    keep: (value) => Effect.runPromise(secrets.keep(Redacted.make(value))),
    read: (id) =>
      Effect.runPromise(
        secrets.read(id).pipe(
          Effect.map((stored) => (stored === undefined ? stored : Redacted.value(stored.value))),
          Effect.catchTag('secret_key_unknown', () => Effect.undefined),
        ),
      ),
    forget: (id) => Effect.runPromise(secrets.forget(id)),
  };
}
