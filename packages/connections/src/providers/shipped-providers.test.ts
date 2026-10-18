import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  additionOfProvider,
  readProviders,
  type Placeholder,
  type Provider,
  type ProviderAddition,
} from '@on.auto/providers';
import { describedToolServers, type ServerSettings, type ToolServers } from '@on.auto/tool-servers';
import { Effect, Redacted, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionIssuesOf, readAddition } from '../entries/entry-checks.ts';
import { credentialFieldIssuesOf } from '../registry/credential.ts';

const shipped = Result.getOrThrow(readProviders());

const checking = {
  org: 'acme',
  modelProviders: ['anthropic', 'openai'],
  providing: { documents: shipped.documents, values: new Map(), documentServer: undefined },
};

const standIn = { value: Redacted.make('a value the person gives'), algorithm: undefined };

const DocumentSchema = Schema.Struct({
  paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
});

function examplesOf({ entry }: Provider): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(entry.placeholders ?? {}).map(
      ([name, { example, choices = [] }]: readonly [string, Placeholder]) => [name, example ?? choices[0]?.value ?? ''],
    ),
  );
}

function additionsOf(provider: Provider): readonly ProviderAddition[] {
  return provider.entry.credentials.map(({ kind }) =>
    Result.getOrThrow(additionOfProvider(provider.entry, { placeholders: examplesOf(provider), kind })),
  );
}

const additions = shipped.providers.flatMap((provider) => additionsOf(provider));

function settingsOf(addition: ProviderAddition): ServerSettings {
  return Result.getOrThrow(readAddition(addition, checking, standIn));
}

function operationsIn(document = ''): number {
  const { paths } = Schema.decodeUnknownSync(Schema.fromJsonString(DocumentSchema))(
    readFileSync(join(shipped.documents, document), 'utf8'),
  );
  return Object.values(paths).flatMap((operations) => Object.keys(operations)).length;
}

function documentsBesideTheEntries(): readonly string[] {
  return readdirSync(join(shipped.documents, 'documents'))
    .map((file) => `documents/${file}`)
    .toSorted();
}

function offeredOperationsOf({ servers }: ToolServers): readonly (readonly [string, number])[] {
  return servers.map((server) => [server.name, server.type === 'openapi' ? server.api.operations.length : 0]);
}

describe('every way of every shipped provider, resolved with the examples of its placeholders', () => {
  it('passes the checks of the credential and of an addition that a connection added by hand passes', () => {
    expect(additions.map(({ name, credential }) => [name, credentialFieldIssuesOf(credential)])).toEqual(
      additions.map(({ name }) => [name, []]),
    );
    expect(additions.map((addition) => [addition.name, additionIssuesOf(addition, checking)])).toEqual(
      additions.map(({ name }) => [name, []]),
    );
  });
});

describe('the documents beside the shipped entries', () => {
  it('are each offered whole by the reader of an HTTP API, every operation a tool within its bounds', async () => {
    const leftOut: string[] = [];
    const described = additions.filter(({ type }) => type === 'openapi');
    const servers = await Effect.runPromise(
      describedToolServers(
        { servers: described.map((addition) => settingsOf(addition)), referencedVariables: [] },
        {
          reportLeftOut: (server, operation) => {
            leftOut.push(`${server}: ${operation.because}`);
          },
        },
      ),
    );

    expect(leftOut).toEqual([]);
    expect(offeredOperationsOf(servers)).toEqual(
      described.map(({ name, entry }) => [name, operationsIn(entry.document)]),
    );
    expect([...new Set(described.map(({ entry }) => String(entry.document)))].toSorted()).toEqual(
      documentsBesideTheEntries(),
    );
    expect(described.length).toBeGreaterThan(0);
  });
});
