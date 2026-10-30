import { required } from '@on.auto/operations';
import { clientIdPlaceholder } from '@on.auto/providers';
import {
  readEntry,
  type Environment,
  type ServerEntryFields,
  type ShippedDocument,
  type ToolServerSettingsContext,
} from '@on.auto/tool-servers';
import { JsonPointer, Redacted, Result, Schema } from 'effect';

import { ConnectionEntrySchema, type ConnectionEntry, type ConnectionType } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';

export interface GivenValue {
  readonly value: Redacted.Redacted;
  readonly algorithm: string | undefined;
}

export interface NamedReference {
  readonly variable: string;
  readonly algorithm: string | undefined;
}

export interface Placing {
  readonly written: ServerEntryFields;
  readonly placedValues: ReadonlyMap<string, string>;
  readonly placedAt: ReadonlyMap<string, string>;
}

export interface Placed extends Placing {
  readonly environment: Environment;
}

type PlacedCredential = Omit<Placing, 'placedValues'>;

type Placement = NonNullable<Credential['in']>;

type Fields = Pick<ServerEntryFields, 'headers' | 'query_params' | 'security'>;

const givenVariable = 'CONNECTION_CREDENTIAL';

const noValuesPlaced: ReadonlyMap<string, string> = new Map();

interface Credentialled {
  readonly provider: string | null;
  readonly entry: ConnectionEntry;
  readonly credential: Credential;
}

function referenceTo(variable: string): string {
  return `\${${variable}}`;
}

const asJson = Schema.decodeUnknownSync(Schema.Json);

const asEntry = Schema.decodeUnknownSync(ConnectionEntrySchema);

function literalText(text: string): string {
  return text.replaceAll('$', () => '$$');
}

function literal(value: Schema.Json): Schema.Json {
  if (typeof value === 'string') {
    return literalText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item: Schema.Json) => literal(item));
  }
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]: readonly [string, Schema.Json]) => [key, literal(item)]),
      )
    : value;
}

const placedIn: Readonly<Record<Placement, (entry: ConnectionEntry, name: string, written: string) => Fields>> = {
  header: ({ headers }, name, written) => ({ headers: { ...headers, [name]: written } }),
  query: ({ query_params: query }, name, written) => ({ query_params: { ...query, [name]: written } }),
  security: (_entry, name, written) => ({ security: { [name]: written } }),
};

const fieldsOfAPlacement: Readonly<Record<Placement, keyof Fields>> = {
  header: 'headers',
  query: 'query_params',
  security: 'security',
};

const nothingPlaced: ReadonlyMap<string, string> = new Map();

function pointerOf(...path: readonly string[]): string {
  return path.map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('');
}

function variableOf(credential: Credential): string {
  return credential.kind === 'reference' ? required(credential.variable) : givenVariable;
}

function writtenValueOf(credential: Credential, variable: string): string {
  const reference = referenceTo(variable);
  return credential.scheme === undefined ? reference : `${credential.scheme} ${reference}`;
}

function placedValue(entry: ConnectionEntry, credential: Credential, variable: string): PlacedCredential {
  const placement = required(credential.in);
  const name = required(credential.name);
  return {
    written: { ...entry, ...placedIn[placement](entry, name, writtenValueOf(credential, variable)) },
    placedAt: new Map([['value', pointerOf(fieldsOfAPlacement[placement], name)]]),
  };
}

function placedClientCredentials(
  { entry, credential }: Credentialled,
  { variable, algorithm }: NamedReference,
): PlacedCredential {
  const reference = referenceTo(variable);
  const secret =
    algorithm === undefined
      ? { client_secret: reference }
      : { private_key: reference, algorithm: literalText(algorithm) };
  const scope = credential.scope === undefined ? {} : { scope: literalText(credential.scope) };
  const issuer = literalText(required(credential.issuer));
  const clientId = required(credential.client_id);
  const auth = { issuer, client_id: literalText(clientId), ...scope, ...secret };
  const given = ['client_id', ...Object.keys(secret)];
  return {
    written: { ...entry, auth },
    placedAt: new Map(given.map((field) => [field, pointerOf('auth', field)])),
  };
}

function clientIdPlacedFor({ provider, credential }: Credentialled): ReadonlyMap<string, string> {
  return provider === null || credential.client_id === undefined
    ? noValuesPlaced
    : new Map([[clientIdPlaceholder, credential.client_id]]);
}

function valuesAsWritten({
  headers,
  query_params: query,
}: ConnectionEntry): Pick<ConnectionEntry, 'headers' | 'query_params'> {
  return {
    ...(headers === undefined ? {} : { headers }),
    ...(query === undefined ? {} : { query_params: query }),
  };
}

function writtenEntryOf({ provider, entry }: Credentialled): ConnectionEntry {
  const literalEntry = asEntry(literal(asJson(entry)));
  return provider === null ? literalEntry : { ...literalEntry, ...valuesAsWritten(entry) };
}

function placedCredentialOf(written: Credentialled, reference: NamedReference | undefined): PlacedCredential {
  const entry = writtenEntryOf(written);
  const { credential } = written;
  if (reference === undefined) {
    return { written: entry, placedAt: nothingPlaced };
  }
  return credential.kind === 'client_credentials'
    ? placedClientCredentials({ ...written, entry }, reference)
    : placedValue(entry, credential, reference.variable);
}

export function placedReference(written: Credentialled, reference: NamedReference | undefined): Placing {
  return { ...placedCredentialOf(written, reference), placedValues: clientIdPlacedFor(written) };
}

export function placedCredential(written: Credentialled, given: GivenValue | undefined): Placed {
  const variable = variableOf(written.credential);
  const placing = placedReference(written, given === undefined ? undefined : { variable, algorithm: given.algorithm });
  return { ...placing, environment: given === undefined ? {} : { [variable]: Redacted.value(given.value) } };
}

interface Named {
  readonly name: string;
  readonly type: ConnectionType;
  readonly provider: string | null;
}

export interface Providing {
  readonly documents: ReadonlyMap<string, ShippedDocument>;
  readonly values: ReadonlyMap<string, Redacted.Redacted>;
  readonly documentServer: string | undefined;
}

interface Reading {
  readonly org: string;
  readonly modelProviders: readonly string[];
  readonly providing: Providing | undefined;
}

function operatorEnvironmentOf(providing: Providing | undefined): Environment {
  return Object.fromEntries(
    [...(providing?.values ?? [])].map(([name, value]: readonly [string, Redacted.Redacted]) => [
      name,
      Redacted.value(value),
    ]),
  );
}

function documentsOf(providing: Providing | undefined): NonNullable<ToolServerSettingsContext['documents']> {
  return providing === undefined ? { kind: 'directory', path: '.' } : { kind: 'shipped', byName: providing.documents };
}

export function readPlaced(
  { name, type, provider }: Named,
  { written, environment, placedValues }: Placed,
  reading: Reading,
) {
  const { org, modelProviders, providing } = reading;
  const read = readEntry(
    name,
    { ...written, type, org },
    { ...operatorEnvironmentOf(providing), ...environment },
    { modelProviders, documents: documentsOf(providing), placedValues },
  );
  return Result.map(read, (settings) => ({ ...settings, provider }));
}
