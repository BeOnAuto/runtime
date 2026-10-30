import type { Issue } from '@on.auto/operations';
import { secretOrKeyExpected, type CredentialGiven } from '@on.auto/tool-servers';
import { Result } from 'effect';

import type { Credential } from '../registry/credential.ts';

export type GivenFields = Omit<CredentialGiven, 'kind'>;

export interface Given {
  readonly pointer: string;
  readonly value: string;
  readonly endsWith?: string;
  readonly algorithm?: string;
  readonly clientId?: string;
}

export interface GivenWords {
  readonly secretAlone: string;
  readonly clientIdLacking: string;
}

export const wordsOfThePage: GivenWords = {
  secretAlone: 'Expected value alone, the secret of a credential of the kind secret',
  clientIdLacking:
    "Expected client_id: the connection's credential holds no client id, so it is given here with the secret or the key",
};

export const wordsOfTheSettings: GivenWords = {
  secretAlone:
    'Expected the credential as a reference alone, such as ${TRACKER_TOKEN}, which a way of the kind secret takes',
  clientIdLacking:
    'Expected client_id, written out beside the client secret or the private key, which a way of the kind client_credentials takes',
};

const charactersShown = 4;

const fewestCharactersToShowAny = 12;

function shownEndingOf(value: string): { readonly endsWith?: string } {
  return value.length < fewestCharactersToShowAny ? {} : { endsWith: value.slice(-charactersShown) };
}

function startsWithItsScheme(value: string, scheme: string | undefined): scheme is string {
  return scheme !== undefined && value.toLowerCase().startsWith(`${scheme.toLowerCase()} `);
}

function schemeWrittenAlready(scheme: string): Issue {
  return {
    pointer: '/value',
    detail: `Paste the token alone, without ${scheme} before it: the runtime writes ${scheme} itself`,
  };
}

function secretOf(fields: GivenFields, scheme: string | undefined, words: GivenWords) {
  const { value, client_id: clientId, client_secret: clientSecret, private_key: privateKey, algorithm } = fields;
  if (value === undefined || [clientId, clientSecret, privateKey, algorithm].some((field) => field !== undefined)) {
    return Result.fail([{ pointer: '', detail: words.secretAlone }]);
  }
  return startsWithItsScheme(value, scheme)
    ? Result.fail([schemeWrittenAlready(scheme)])
    : Result.succeed({ pointer: '/value', value, ...shownEndingOf(value) });
}

function clientSecretOf(fields: GivenFields): Given | undefined {
  const { value, client_secret: clientSecret, private_key: privateKey, algorithm } = fields;
  if (value === undefined && clientSecret !== undefined && privateKey === undefined && algorithm === undefined) {
    return { pointer: '/client_secret', value: clientSecret, ...shownEndingOf(clientSecret) };
  }
  return value === undefined && clientSecret === undefined && privateKey !== undefined && algorithm !== undefined
    ? { pointer: '/private_key', value: privateKey, algorithm }
    : undefined;
}

const clientIdHeldAlready: Issue = {
  pointer: '/client_id',
  detail: "Expected no client_id: the connection's credential holds its client id already",
};

function clientIdPresenceIssuesOf(
  { client_id: held }: Credential,
  { client_id: given }: GivenFields,
  words: GivenWords,
): readonly Issue[] {
  if (held === undefined && given === undefined) {
    return [{ pointer: '/client_id', detail: words.clientIdLacking }];
  }
  return held !== undefined && given !== undefined ? [clientIdHeldAlready] : [];
}

function clientCredentialsOf(credential: Credential, fields: GivenFields, words: GivenWords) {
  const secret = clientSecretOf(fields);
  const clientIdIssues = clientIdPresenceIssuesOf(credential, fields, words);
  if (secret === undefined) {
    return Result.fail([{ pointer: '', detail: secretOrKeyExpected }, ...clientIdIssues]);
  }
  if (clientIdIssues.length > 0) {
    return Result.fail(clientIdIssues);
  }
  return Result.succeed(fields.client_id === undefined ? secret : { ...secret, clientId: fields.client_id });
}

export function givenFieldsOf(
  credential: Credential,
  fields: GivenFields,
  words: GivenWords,
): Result.Result<Given, readonly Issue[]> {
  return credential.kind === 'client_credentials'
    ? clientCredentialsOf(credential, fields, words)
    : secretOf(fields, credential.scheme, words);
}
