import {
  clientIdWrittenOut,
  credentialProblems,
  problem,
  variableNamePattern,
  type SettingProblem,
} from '@on.auto/config';
import type { Issue } from '@on.auto/operations';
import { Function, Result } from 'effect';

import { at } from './checked.ts';
import { toolServersSetting, type ServerEntryFields } from './server-entries.ts';

export interface CredentialGiven {
  readonly kind?: string | undefined;
  readonly value?: string | undefined;
  readonly client_id?: string | undefined;
  readonly client_secret?: string | undefined;
  readonly private_key?: string | undefined;
  readonly algorithm?: string | undefined;
}

export interface ProviderNamed {
  readonly provider: string;
  readonly placeholders: Readonly<Record<string, string>>;
  readonly credential: CredentialGiven;
}

export interface ProviderResolved {
  readonly written: ServerEntryFields;
  readonly placedValues: ReadonlyMap<string, string>;
  readonly documentsDirectory: string;
  readonly writtenAt: (pointer: string) => string;
}

export type ProviderResolver = (named: ProviderNamed) => Result.Result<ProviderResolved, readonly Issue[]>;

export const noProviders: ProviderResolver = ({ provider }) =>
  Result.fail([{ pointer: '/provider', detail: `This reading knows no provider, so none named ${provider}` }]);

export interface EntryReading {
  readonly placedValues: ReadonlyMap<string, string> | undefined;
  readonly documentsDirectory: string | undefined;
  readonly providers: ProviderResolver | undefined;
}

export interface EntryToRead {
  readonly written: ServerEntryFields;
  readonly placedValues: ReadonlyMap<string, string>;
  readonly documentsDirectory: string;
  readonly provider: string | null;
  readonly placed: (problems: readonly SettingProblem[]) => readonly SettingProblem[];
}

type WrittenCredential = NonNullable<ServerEntryFields['credential']>;

type CredentialFields = Exclude<WrittenCredential, string>;

const fieldsOfTheServer = [
  'type',
  'url',
  'headers',
  'auth',
  'command',
  'args',
  'env',
  'document',
  'base_url',
  'query_params',
  'security',
  'request_id',
] as const satisfies readonly (keyof ServerEntryFields)[];

const perConnection = ['org', 'playbooks', 'allowed', 'record_content'] as const satisfies readonly string[];

const takenWithAProvider = ['placeholders', 'credential'] as const satisfies readonly (keyof ServerEntryFields)[];

const referenced = ['value', 'client_secret', 'private_key'] as const satisfies readonly (keyof CredentialFields)[];

const writtenOut = ['kind', 'client_id', 'algorithm'] as const satisfies readonly (keyof CredentialFields)[];

const referenceAlone =
  'Expected a reference alone to the environment variable that holds the credential, such as ${TRACKER_TOKEN}, which the provider places where its way says';

const dollarWrittenOut = 'Expected no $: of a credential, only value, client_secret and private_key hold a reference';

const theCredential = '/credential';

const clientIdField = 'client_id';

function variableOf(text: string): string | undefined {
  const variable = text.startsWith('${') && text.endsWith('}') ? text.slice(2, -1) : undefined;
  return variable !== undefined && variableNamePattern.test(variable) ? variable : undefined;
}

function variableIn(text: string | undefined): string | undefined {
  return text === undefined ? undefined : variableOf(text);
}

function fieldsOf(credential: WrittenCredential): CredentialFields {
  return typeof credential === 'string' ? { value: credential } : credential;
}

export function givenByTheProvider(field: string): string {
  return `Expected no ${field}: the provider gives the server`;
}

function looksLikeACredential(clientId: string | undefined): boolean {
  return clientId !== undefined && credentialProblems(clientIdField, clientId, '').length > 0;
}

function credentialProblemsOf(name: string, credential: WrittenCredential): readonly SettingProblem[] {
  const fields = fieldsOf(credential);
  const placeOf = (field: string): string =>
    typeof credential === 'string' ? at(name, 'credential') : at(name, 'credential', field);
  return [
    ...referenced
      .filter((field) => fields[field] !== undefined && variableIn(fields[field]) === undefined)
      .map((field) => problem(toolServersSetting, placeOf(field), referenceAlone)),
    ...writtenOut
      .filter((field) => fields[field]?.includes('$') === true)
      .map((field) => problem(toolServersSetting, placeOf(field), dollarWrittenOut)),
    ...(looksLikeACredential(fields.client_id)
      ? [problem(toolServersSetting, placeOf(clientIdField), clientIdWrittenOut)]
      : []),
  ];
}

function shapeProblemsOf(name: string, written: ServerEntryFields): readonly SettingProblem[] {
  if (written.provider === undefined) {
    return takenWithAProvider
      .filter((field) => written[field] !== undefined)
      .map((field) => problem(toolServersSetting, at(name, field), `Expected no ${field} without provider`));
  }
  return [
    ...fieldsOfTheServer
      .filter((field) => written[field] !== undefined)
      .map((field) => problem(toolServersSetting, at(name, field), givenByTheProvider(field))),
    ...(written.credential === undefined ? [] : credentialProblemsOf(name, written.credential)),
  ];
}

function credentialGivenOf(credential: WrittenCredential | undefined): CredentialGiven {
  const fields = fieldsOf(credential ?? {});
  return {
    kind: fields.kind,
    value: variableIn(fields.value),
    client_id: fields.client_id,
    client_secret: variableIn(fields.client_secret),
    private_key: variableIn(fields.private_key),
    algorithm: fields.algorithm,
  };
}

function perConnectionOf({ org, playbooks, allowed, record_content: recordContent }: ServerEntryFields) {
  return {
    ...(org === undefined ? {} : { org }),
    ...(playbooks === undefined ? {} : { playbooks }),
    ...(allowed === undefined ? {} : { allowed }),
    ...(recordContent === undefined ? {} : { record_content: recordContent }),
  };
}

function isWrittenByTheOperator(relative: string): boolean {
  const [, field = ''] = relative.split('/');
  return perConnection.some((each) => each === field);
}

function asWritten(credential: WrittenCredential | undefined): (pointer: string) => string {
  return (pointer) => (typeof credential === 'string' && pointer.startsWith(theCredential) ? theCredential : pointer);
}

function placedIn(name: string, writtenAt: (pointer: string) => string) {
  const entry = at(name);
  return (problems: readonly SettingProblem[]): readonly SettingProblem[] =>
    problems.map(({ setting, pointer = '', detail }) => {
      const relative = pointer.slice(entry.length);
      return pointer.startsWith(`${entry}/`) && !isWrittenByTheOperator(relative)
        ? problem(setting, `${entry}${writtenAt(relative)}`, detail)
        : problem(setting, pointer, detail);
    });
}

function plainEntry(written: ServerEntryFields, reading: EntryReading): EntryToRead {
  return {
    written,
    placedValues: reading.placedValues ?? new Map(),
    documentsDirectory: reading.documentsDirectory ?? process.cwd(),
    provider: null,
    placed: Function.identity,
  };
}

function resolvedEntry(
  name: string,
  written: ServerEntryFields,
  provider: string,
  { providers = noProviders }: EntryReading,
): Result.Result<EntryToRead, readonly SettingProblem[]> {
  const writtenPointer = asWritten(written.credential);
  const named = {
    provider,
    placeholders: written.placeholders ?? {},
    credential: credentialGivenOf(written.credential),
  };
  return Result.mapBoth(providers(named), {
    onFailure: (issues) =>
      issues.map(({ pointer, detail }) => problem(toolServersSetting, `${at(name)}${writtenPointer(pointer)}`, detail)),
    onSuccess: (resolved): EntryToRead => ({
      written: { ...resolved.written, ...perConnectionOf(written) },
      placedValues: resolved.placedValues,
      documentsDirectory: resolved.documentsDirectory,
      provider,
      placed: placedIn(name, (pointer) => writtenPointer(resolved.writtenAt(pointer))),
    }),
  });
}

export function entryToRead(
  name: string,
  written: ServerEntryFields,
  reading: EntryReading,
): Result.Result<EntryToRead, readonly SettingProblem[]> {
  const problems = shapeProblemsOf(name, written);
  if (problems.length > 0) {
    return Result.fail(problems);
  }
  return written.provider === undefined
    ? Result.succeed(plainEntry(written, reading))
    : resolvedEntry(name, written, written.provider, reading);
}
