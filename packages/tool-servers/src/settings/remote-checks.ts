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
import type { AuthCredential, AuthSettings } from './server-settings.ts';

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

function checkedCredential(name: string, { client_secret, private_key, algorithm }: Auth): Checked<AuthCredential> {
  if (client_secret !== undefined && private_key === undefined && algorithm === undefined) {
    return accepted({ kind: 'client_secret', client_secret: Redacted.make(client_secret) });
  }
  if (private_key !== undefined && algorithm !== undefined && client_secret === undefined) {
    return accepted({ kind: 'private_key', private_key: Redacted.make(private_key), algorithm });
  }
  return refused(name, ['auth'], secretOrKeyExpected);
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
  const problems = problemsOf(issuer, alone, credential);
  return credential.ok && problems.length === 0
    ? accepted({
        issuer: auth.issuer,
        client_id: auth.client_id,
        scope: auth.scope ?? null,
        credential: credential.value,
      })
    : rejected(problems);
}
