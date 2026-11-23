import { createHash } from 'node:crypto';

import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { actingAsAnAccount, keptWaysOfAServer, requested, wayChosenAgain } from '../testing/account-type-facts.ts';
import { heldAppCredentials, modelSet } from '../testing/app-credential-facts.ts';
import { givenItsEvents, identifiedByTheRuntime, identifiedInItsAccount, placeNamed } from '../testing/event-facts.ts';
import { connectedForItsAccount, throughAGateway } from '../testing/gateway-facts.ts';
import { addedActingAsItself, addedAsAServiceAccount, wayChosenWithItsValues } from '../testing/way-value-facts.ts';
import { ConnectionEventSchema } from './connection-events.ts';

const decoded = Schema.decodeUnknownResult(ConnectionEventSchema);

function addedWith(provider: string | null, credential: Readonly<Record<string, unknown>>, ways?: readonly unknown[]) {
  return {
    type: 'connection_added',
    data: {
      connection: 'connection-1',
      name: 'files',
      server_type: 'mcp',
      provider,
      placeholders: null,
      entry: { url: 'https://mcp.files.example.com/mcp' },
      credential,
      ...(ways === undefined ? {} : { ways }),
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' },
  };
}

const issuer = 'https://auth.files.example.com';

describe('the credential a connection of consent given by hand is recorded with', () => {
  it('holds its clients, each one the runtime makes for itself, where a provider’s way may leave them to their default, and ways only beside a server given by hand', () => {
    const outcomes = [
      addedWith(null, { kind: 'authorization', issuer, clients: ['dynamic'] }),
      addedWith(null, { kind: 'authorization', issuer }),
      addedWith(null, { kind: 'authorization', issuer, clients: ['registered', 'dynamic'] }),
      addedWith('files', { kind: 'authorization', issuer }),
      addedWith(null, { kind: 'none' }),
      addedWith(null, { kind: 'none' }, [{ kind: 'none' }]),
      addedWith('files', { kind: 'authorization', issuer }, [{ kind: 'authorization', issuer }]),
    ].map((fact: unknown) => Result.isSuccess(decoded(fact)));

    expect(outcomes).toEqual([true, false, false, true, true, true, false]);
  });
});

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

const caller = { id: 'key_7f3a', name: 'key_7f3a' };

const ofTheConnection = { connection: 'connection-1' };

const startedBefore = {
  ...ofTheConnection,
  state_sha256: 'd4e5f6',
  verifier_secret_id: 'secret-2',
  client_id: 'client-1',
  client_source: 'dynamic',
  expires_at: '2026-10-29T10:10:00.000Z',
} as const;

const baseline: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'crm',
      server_type: 'mcp',
      provider: null,
      placeholders: { region: 'eu' },
      entry: {
        url: 'https://mcp.crm.example.com/mcp',
        headers: { 'x-team': 'sales' },
        allowed: ['find_contact'],
        record_content: true,
      },
      credential: { kind: 'secret', name: 'Authorization', in: 'header', scheme: 'Bearer' },
      says: { region: 'The region of the account' },
      added_by: caller,
    },
    context: acted,
  },
  { type: 'connection_link_issued', data: { ...ofTheConnection, token_sha256: 'a1b2c3' }, context: acted },
  {
    type: 'connection_consent_started',
    data: { ...startedBefore, says: {} },
    context: acted,
  },
  { type: 'connection_approved', data: ofTheConnection, context: acted },
  {
    type: 'connection_connected',
    data: {
      ...ofTheConnection,
      secret_id: 'secret-3',
      algorithm: 'ES256',
      client_id: 'client-1',
      client_source: 'dynamic',
      scope: 'contacts.read',
      connected_by: caller,
    },
    context: acted,
  },
  {
    type: 'connection_broken',
    data: { ...ofTheConnection, kind: 'credential_refused', reason: 'The server refused the credential' },
    context: acted,
  },
  { type: 'connection_removed', data: ofTheConnection, context: acted },
];

const askingMore: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_link_issued',
    data: { ...ofTheConnection, token_sha256: 'a1b2c3', more: 'edit' },
    context: acted,
  },
  {
    type: 'connection_consent_started',
    data: {
      ...startedBefore,
      scope: 'contacts.read contacts.write',
      says: { 'contacts.write': 'Change the contacts of the account.' },
    },
    context: acted,
  },
];

const underTheOrgsOAuthClient: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'files',
      server_type: 'mcp',
      provider: 'files',
      placeholders: {},
      entry: { url: 'https://mcp.files.example.com/mcp' },
      credential: { kind: 'authorization', issuer, scope: 'files.read', client_source: 'own' },
      says: { 'files.read': 'Read the files of the account.' },
      added_by: caller,
    },
    context: acted,
  },
  {
    type: 'connection_client_given',
    data: { ...ofTheConnection, client_id: 'org-app', secret_id: 'secret-4' },
    context: acted,
  },
  {
    type: 'connection_connected',
    data: {
      ...ofTheConnection,
      secret_id: 'secret-5',
      client_id: 'org-app',
      client_source: 'own',
      scope: 'files.read',
      connected_by: caller,
    },
    context: acted,
  },
];

const askedBy = { id: 'https://agent.example/oauth/client.json', name: 'An agent', domain: 'agent.example' };

const askedThroughAClient: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_link_issued',
    data: { ...ofTheConnection, token_sha256: 'a1b2c3', asked_by: askedBy },
    context: acted,
  },
];

const issuedWithNoEnd: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_link_issued',
    data: { ...ofTheConnection, token_sha256: 'e5f6a7', more: 'edit', asked_by: askedBy },
    context: acted,
  },
];

const describedKey: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'crm',
      server_type: 'mcp',
      provider: null,
      placeholders: null,
      entry: { url: 'https://mcp.crm.example.com/mcp' },
      credential: {
        kind: 'secret',
        name: 'Authorization',
        in: 'header',
        scheme: 'Bearer',
        instructions: 'Make a key in the CRM under **Settings**, [API keys](https://crm.example.com/settings/keys).',
        key_page: 'https://crm.example.com/settings/keys',
        example: 'crm_…',
        pattern: '^crm_\\w+$',
      },
      says: {},
      added_by: caller,
    },
    context: acted,
  },
];

const playbooksSet: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_playbooks_set',
    data: { ...ofTheConnection, playbooks: ['sales', 'support'] },
    context: acted,
  },
];

const signingSecrets: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_signing_secret_set',
    data: { ...ofTheConnection, secret_id: 'secret-6', previous_until: '2026-10-30T10:00:00.000Z' },
    context: acted,
  },
  {
    type: 'connection_signing_secret_removed',
    data: { ...ofTheConnection, which: 'previous' },
    context: acted,
  },
];

const documentText = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Ledgers', version: '1' },
  paths: { '/entries': { get: { operationId: 'list_entries', summary: 'Lists the entries of the ledger.' } } },
});

const givenItsDocument: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'ledgers',
      server_type: 'openapi',
      provider: null,
      placeholders: null,
      entry: { base_url: 'https://api.ledgers.example.com/v1' },
      document: {
        sha256: createHash('sha256').update(documentText).digest('hex'),
        bytes: new TextEncoder().encode(documentText).byteLength,
        tool_count: 1,
      },
      credential: {
        kind: 'secret',
        name: 'X-Ledgers-Key',
        in: 'header',
        instructions: 'Make a key under [Settings, API keys](https://ledgers.example.com/settings/keys).',
        key_page: 'https://ledgers.example.com/settings/keys',
      },
      says: {},
      added_by: caller,
    },
    context: acted,
  },
];

describe('the facts of the registry of connections', () => {
  recordedFactsBehaviour({
    schema: ConnectionEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.46.0': baseline,
      '0.49.0': [...askingMore, ...underTheOrgsOAuthClient],
      '0.54.0': askedThroughAClient,
      '0.57.0': [...describedKey, ...playbooksSet, ...signingSecrets],
      '0.59.0': [...givenItsDocument, ...connectedForItsAccount],
      '0.60.0': throughAGateway,
      '0.67.0': heldAppCredentials,
      '0.69.0': [...givenItsEvents, ...identifiedByTheRuntime],
      '0.70.0': [...actingAsAnAccount, ...wayChosenAgain],
      '0.71.0': [...keptWaysOfAServer, ...identifiedInItsAccount, ...requested],
      '0.72.0': [...wayChosenWithItsValues, ...issuedWithNoEnd, ...placeNamed, ...addedAsAServiceAccount, ...modelSet],
      '0.73.0': addedActingAsItself,
    },
  });
});

describe('a start of a consent an earlier release recorded', () => {
  it('reads as one that adds no words, whose scope the fold takes from the credential, since it names none', () => {
    const recordedBefore = { type: 'connection_consent_started', data: startedBefore, context: acted };

    expect(Result.getOrThrow(decoded(recordedBefore))).toEqual({
      ...recordedBefore,
      data: { ...startedBefore, says: {} },
    });
  });
});
