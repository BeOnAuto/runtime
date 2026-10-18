import { credentialProblems, substituted, type SettingProblem } from '@on.auto/config';
import { Conflict, InvalidInput, type Issue } from '@on.auto/operations';
import {
  isPinnableUrl,
  pinnedUrlShape,
  serverNameProblems,
  takenByTheConfiguration,
  type ServerSettings,
} from '@on.auto/tool-servers';
import { JsonPointer, Redacted, Result, Schema } from 'effect';

import type { ConnectionEntry, ConnectionType } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';
import { placedCredential, readPlaced, type GivenValue } from '../serving/placed-credentials.ts';
import { credentialIssuesOf } from './credential-checks.ts';

export interface AdditionInput {
  readonly name: string;
  readonly type: ConnectionType;
  readonly entry: ConnectionEntry;
  readonly credential: Credential;
}

export interface EntryChecking {
  readonly org: string;
  readonly modelProviders: readonly string[];
}

const heldCredential =
  "Looks like a credential, which a connection's entry never holds: the person gives it on the page the link opens";

const clientIdOfTheReading = '/entry/auth/client_id';

interface ClientIdWords {
  readonly onThePage: Issue;
  readonly inTheAddition: Issue;
}

const heldCredentialAsClientId: ClientIdWords = {
  onThePage: {
    pointer: '/client_id',
    detail:
      "Looks like a credential, which a client id never is: the connection's record keeps the client id in the open, so the secret or the key goes in its own field, where it is sealed",
  },
  inTheAddition: {
    pointer: '/credential/client_id',
    detail:
      'Looks like a credential, which a client id never is: leave the secret out, and the person gives it on the page the link opens',
  },
};

const heldReference =
  "Holds a reference to an environment variable, which a connection's entry never holds: a reference credential names the variable";

const fileOnly = `${pinnedUrlShape}: a connection reads its document from the network, never from the runtime’s disk`;

const anyValue: GivenValue = { value: Redacted.make('a value the person gives'), algorithm: undefined };

const anyClientId = 'a client id the person gives';

const asJson = Schema.decodeUnknownSync(Schema.Json);

function issuesOf(problems: readonly SettingProblem[], from: string, to: string): readonly Issue[] {
  return problems.map(({ pointer = '', detail }) => ({ pointer: `${to}${pointer.slice(from.length)}`, detail }));
}

function placed(pointers: readonly string[], detail: string): readonly Issue[] {
  return [...new Set(pointers)].map((pointer) => ({ pointer, detail }));
}

function writtenIssues(name: string, entry: ConnectionEntry): readonly Issue[] {
  const written = asJson(entry);
  const resolved = substituted(written, '/entry', {});
  return [
    ...placed(
      credentialProblems(name, written, '/entry').map(({ pointer }) => pointer),
      heldCredential,
    ),
    ...placed(
      [...resolved.problems, ...resolved.references].map(({ pointer }) => pointer),
      heldReference,
    ),
  ];
}

function addressIssues({ type, entry }: AdditionInput): readonly Issue[] {
  if (type === 'mcp') {
    return entry.url === undefined || isPinnableUrl(entry.url)
      ? []
      : [{ pointer: '/entry/url', detail: pinnedUrlShape }];
  }
  return entry.document !== undefined && !URL.canParse(entry.document)
    ? [{ pointer: '/entry/document', detail: fileOnly }]
    : [];
}

export function entryIssuesOf(input: AdditionInput, checking: EntryChecking): readonly Issue[] {
  const named = issuesOf(
    serverNameProblems(input.name, checking.modelProviders),
    `/${JsonPointer.escapeToken(input.name)}`,
    '/name',
  );
  return [
    ...named,
    ...addressIssues(input),
    ...writtenIssues(input.name, input.entry),
    ...credentialIssuesOf(input.credential, input.type, input.entry),
  ];
}

export function readAddition(
  input: AdditionInput,
  checking: EntryChecking,
  given: GivenValue | undefined,
): Result.Result<ServerSettings, readonly Issue[]> {
  const read = readPlaced(input, placedCredential(input.entry, input.credential, given), checking);
  return Result.mapError(read, (problems) => issuesOf(problems, `/${JsonPointer.escapeToken(input.name)}`, '/entry'));
}

function withAnyClientId(credential: Credential): Credential {
  return credential.kind === 'client_credentials' && credential.client_id === undefined
    ? { ...credential, client_id: anyClientId }
    : credential;
}

function readingIssuesOf(input: AdditionInput, checking: EntryChecking): readonly Issue[] {
  const given = input.credential.kind === 'none' ? undefined : anyValue;
  return Result.match(readAddition(input, checking, given), { onSuccess: () => [], onFailure: (read) => read });
}

function isOfTheClientId({ pointer }: Issue): boolean {
  return pointer === clientIdOfTheReading;
}

export function additionIssuesOf(input: AdditionInput, checking: EntryChecking): readonly Issue[] {
  const issues = entryIssuesOf(input, checking);
  if (issues.length > 0) {
    return issues;
  }
  const read = readingIssuesOf({ ...input, credential: withAnyClientId(input.credential) }, checking);
  return read.map((issue) => (isOfTheClientId(issue) ? heldCredentialAsClientId.inTheAddition : issue));
}

export function clientIdReadingIssuesOf(
  input: AdditionInput,
  clientId: string,
  checking: EntryChecking,
): readonly Issue[] {
  const withTheClientId = { ...input, credential: { ...input.credential, client_id: clientId } };
  return readingIssuesOf(withTheClientId, checking)
    .filter((issue) => isOfTheClientId(issue))
    .map(() => heldCredentialAsClientId.onThePage);
}

export function invalidAddition(issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: 'The connection cannot be added as it is given', issues });
}

export function conflictAsTakenByTheFile(name: string): Conflict {
  return new Conflict({ detail: takenByTheConfiguration(name), kind: 'taken' });
}
