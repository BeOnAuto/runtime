import { readFileSync } from 'node:fs';

import { ActedContextSchema, factOf, RecordedCallerSchema } from '@on.auto/operations';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

const sourcesBeforeTheGateway = Schema.Literals(['registered', 'auto', 'metadata_document', 'dynamic', 'own']);

const ConnectedBeforeTheAccount = factOf(
  'connection_connected',
  Schema.Struct({
    connection: Schema.String,
    secret_id: Schema.optionalKey(Schema.String),
    algorithm: Schema.optionalKey(Schema.String),
    client_id: Schema.optionalKey(Schema.String),
    client_source: Schema.optionalKey(sourcesBeforeTheGateway),
    scope: Schema.optionalKey(Schema.String),
    connected_by: RecordedCallerSchema,
  }),
  ActedContextSchema,
);

const StartedBeforeTheGateway = factOf(
  'connection_consent_started',
  Schema.Struct({
    connection: Schema.String,
    state_sha256: Schema.String,
    verifier_secret_id: Schema.String,
    client_id: Schema.String,
    client_source: sourcesBeforeTheGateway,
    expires_at: Schema.String,
    scope: Schema.optionalKey(Schema.String),
    says: Schema.Record(Schema.String, Schema.String),
  }),
  ActedContextSchema,
);

function recordedIn(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

const readBefore = Schema.decodeUnknownResult(Schema.toCodecJson(ConnectedBeforeTheAccount));

const startedBefore = Schema.decodeUnknownResult(Schema.toCodecJson(StartedBeforeTheGateway));

describe('a connection connected for its account, as a release before the member reads it', () => {
  it('reads the fact recorded in 0.59.0 through that release’s schema, passing over the account it does not know', () => {
    expect(Result.getOrThrow(readBefore(recordedIn('0.59.0/connection_connected.json')))).toEqual({
      type: 'connection_connected',
      data: {
        connection: 'connection-1',
        secret_id: 'secret-7',
        client_id: 'auto-runtime',
        client_source: 'registered',
        scope: 'files.read',
        connected_by: { id: 'key_7f3a', name: 'key_7f3a' },
      },
      context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
    });
  });
});

describe('a consent made through a gateway, as a release before the gateway reads it', () => {
  it('is not read, since the gateway is a source of a client that release does not know, so the readers ship before anything writes it', () => {
    expect([
      Result.isFailure(readBefore(recordedIn('0.60.0/connection_connected.json'))),
      Result.isFailure(startedBefore(recordedIn('0.60.0/connection_consent_started.json'))),
    ]).toEqual([true, true]);
  });
});
