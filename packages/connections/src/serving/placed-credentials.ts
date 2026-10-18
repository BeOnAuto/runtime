import { clientIdPlaceholder } from '@on.auto/providers';
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
  readonly placedValues: ReadonlyMap<string, string>;
}

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

function placedClientCredentials({ provider, entry, credential }: Credentialled, given: GivenValue): Placed {
  const reference = referenceTo(givenVariable);
  const secret =
    given.algorithm === undefined
      ? { client_secret: reference }
      : { private_key: reference, algorithm: literalText(given.algorithm) };
  const scope = credential.scope === undefined ? {} : { scope: literalText(credential.scope) };
  const issuer = literalText(required(credential.issuer));
  const clientId = required(credential.client_id);
  const auth = { issuer, client_id: literalText(clientId), ...scope, ...secret };
  return {
    written: { ...entry, auth },
    environment: { [givenVariable]: Redacted.value(given.value) },
    placedValues: provider === null ? noValuesPlaced : new Map([[clientIdPlaceholder, clientId]]),
  };
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

export function placedCredential(written: Credentialled, given: GivenValue | undefined): Placed {
  const entry = writtenEntryOf(written);
  const { credential } = written;
  if (given === undefined) {
    return { written: entry, environment: {}, placedValues: noValuesPlaced };
  }
  return credential.kind === 'client_credentials'
    ? placedClientCredentials({ ...written, entry }, given)
    : {
        written: placedValue(entry, credential),
        environment: { [variableOf(credential)]: Redacted.value(given.value) },
        placedValues: noValuesPlaced,
      };
}

interface Named {
  readonly name: string;
  readonly type: ConnectionType;
}

export interface Providing {
  readonly documents: string;
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

export function readPlaced({ name, type }: Named, { written, environment, placedValues }: Placed, reading: Reading) {
  const { org, modelProviders, providing } = reading;
  return readEntry(
    name,
    { ...written, type, org },
    { ...operatorEnvironmentOf(providing), ...environment },
    { modelProviders, documentsDirectory: providing?.documents ?? '.', placedValues },
  );
}
