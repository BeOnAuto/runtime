import { Redacted } from 'effect';

import {
  accepted,
  headerNamePattern,
  isPinnableUrl,
  pinnedUrlShape,
  problemsOf,
  refused,
  rejected,
  redactedValuesOf,
  type Checked,
} from './checked.ts';
import { headersTheRuntimeSets, type RemoteServerType } from './reserved-headers.ts';
import type { ServerEntryFields } from './server-entries.ts';
import type { AuthSettings, MintingCredential } from './server-settings.ts';

type Auth = NonNullable<ServerEntryFields['auth']>;

export function checkedHeaders(
  name: string,
  headers: Readonly<Record<string, string>>,
  type: RemoteServerType,
): Checked<ReadonlyMap<string, Redacted.Redacted>> {
  const reserved = headersTheRuntimeSets(type);
  const problems = problemsOf(
    ...Object.keys(headers).map((header) => {
      if (!headerNamePattern.test(header)) {
        return refused(name, ['headers', header], 'Expected a header name');
      }
      return reserved.names.has(header.toLowerCase())
        ? refused(name, ['headers', header], `A header ${reserved.setBy} sets itself`)
        : accepted(header);
    }),
  );
  return problems.length === 0 ? accepted(redactedValuesOf(headers)) : rejected(problems);
}

export const secretOrKeyExpected = 'Expected client_secret, or private_key with its algorithm, one of the two';

function checkedCredential(name: string, { client_secret, private_key, algorithm }: Auth): Checked<MintingCredential> {
  if (client_secret !== undefined && private_key === undefined && algorithm === undefined) {
    return accepted({ kind: 'client_secret', client_secret: Redacted.make(client_secret) });
  }
  if (private_key !== undefined && algorithm !== undefined && client_secret === undefined) {
    return accepted({ kind: 'private_key', private_key: Redacted.make(private_key), algorithm });
  }
  return refused(name, ['auth'], secretOrKeyExpected);
}

type Granted = Pick<AuthSettings, 'grant' | 'subject'>;

const assertionExpected =
  'Expected private_key with its algorithm, and subject, which grant jwt_bearer takes, and no client_secret';

const subjectOfAnAssertion = 'Expected subject only beside grant jwt_bearer, which asks for a token for that account';

function checkedGrant(name: string, { grant, subject, private_key, client_secret }: Auth): Checked<Granted> {
  if (grant !== 'jwt_bearer') {
    return subject === undefined ? accepted({}) : refused(name, ['auth', 'subject'], subjectOfAnAssertion);
  }
  return subject !== undefined && private_key !== undefined && client_secret === undefined
    ? accepted({ grant, subject })
    : refused(name, ['auth'], assertionExpected);
}

function authSettingsOf(auth: Auth, granted: Granted, credential: MintingCredential): AuthSettings {
  return {
    issuer: auth.issuer,
    client_id: auth.client_id,
    scope: auth.scope ?? null,
    ...(auth.discovery === undefined ? {} : { discovery: auth.discovery }),
    ...(auth.audience === undefined ? {} : { audience: auth.audience }),
    ...granted,
    credential,
  };
}

export function checkedAuth(name: string, { auth, headers = {} }: ServerEntryFields): Checked<AuthSettings | null> {
  if (auth === undefined) {
    return accepted(null);
  }
  const issuer = isPinnableUrl(auth.issuer) ? accepted(auth.issuer) : refused(name, ['auth', 'issuer'], pinnedUrlShape);
  const alone = Object.keys(headers).some((header) => header.toLowerCase() === 'authorization')
    ? refused(name, ['auth'], 'Set an Authorization header or an auth block, not both')
    : accepted(auth);
  const credential = checkedCredential(name, auth);
  const granted = checkedGrant(name, auth);
  const problems = problemsOf(issuer, alone, credential, granted);
  return credential.ok && granted.ok && problems.length === 0
    ? accepted(authSettingsOf(auth, granted.value, credential.value))
    : rejected(problems);
}
