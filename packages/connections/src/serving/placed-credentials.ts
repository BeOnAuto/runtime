import { readEntry, type Environment, type ServerEntryFields } from '@on.auto/tool-servers';
import { Option, Redacted, Schema } from 'effect';

import { ConnectionEntrySchema, type ConnectionEntry, type ConnectionType } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';

export interface GivenValue {
  readonly value: Redacted.Redacted;
  readonly algorithm: string | undefined;
}

export interface Placed {
  readonly written: ServerEntryFields;
  readonly environment: Environment;
}

type Placement = NonNullable<Credential['in']>;

type Fields = Pick<ServerEntryFields, 'headers' | 'query_params' | 'security'>;

const givenVariable = 'CONNECTION_CREDENTIAL';

function referenceTo(variable: string): string {
  return `\${${variable}}`;
}

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
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

function variableOf(credential: Credential): string {
  return credential.kind === 'reference' ? required(credential.variable) : givenVariable;
}

function writtenValueOf(credential: Credential): string {
  const reference = referenceTo(variableOf(credential));
  return credential.scheme === undefined ? reference : `${credential.scheme} ${reference}`;
}

function placedValue(entry: ConnectionEntry, credential: Credential): ServerEntryFields {
  const fields = placedIn[required(credential.in)](entry, required(credential.name), writtenValueOf(credential));
  return { ...entry, ...fields };
}

function placedClientCredentials(entry: ConnectionEntry, credential: Credential, given: GivenValue): ServerEntryFields {
  const reference = referenceTo(givenVariable);
  const secret =
    given.algorithm === undefined
      ? { client_secret: reference }
      : { private_key: reference, algorithm: literalText(given.algorithm) };
  const scope = credential.scope === undefined ? {} : { scope: literalText(credential.scope) };
  const issuer = literalText(required(credential.issuer));
  const auth = { issuer, client_id: literalText(required(credential.client_id)), ...scope, ...secret };
  return { ...entry, auth };
}

export function placedCredential(
  written: ConnectionEntry,
  credential: Credential,
  given: GivenValue | undefined,
): Placed {
  const entry = asEntry(literal(asJson(written)));
  if (given === undefined) {
    return { written: entry, environment: {} };
  }
  const environment = { [variableOf(credential)]: Redacted.value(given.value) };
  return credential.kind === 'client_credentials'
    ? { written: placedClientCredentials(entry, credential, given), environment }
    : { written: placedValue(entry, credential), environment };
}

interface Named {
  readonly name: string;
  readonly type: ConnectionType;
}

interface Reading {
  readonly org: string;
  readonly modelProviders: readonly string[];
}

export function readPlaced({ name, type }: Named, { written, environment }: Placed, { org, modelProviders }: Reading) {
  return readEntry(name, { ...written, type, org }, environment, {
    modelProviders,
    documentsDirectory: '.',
  });
}
