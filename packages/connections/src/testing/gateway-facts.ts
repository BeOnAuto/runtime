import type { ConnectionEventSchema } from '../registry/connection-events.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

const caller = { id: 'key_7f3a', name: 'key_7f3a' };

const ofTheConnection = { connection: 'connection-1' };

export const connectedForItsAccount: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_connected',
    data: {
      ...ofTheConnection,
      secret_id: 'secret-7',
      client_id: 'auto-runtime',
      client_source: 'registered',
      scope: 'files.read',
      account: { id: 'A0001', name: 'Test Account' },
      connected_by: caller,
    },
    context: acted,
  },
];

export const gatewayIssuer = 'https://messages.example.com';

export const throughAGateway: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'messages',
      server_type: 'openapi',
      provider: 'messages',
      placeholders: {},
      entry: { document: 'https://gateway.messages.example.com/openapi.json' },
      credential: {
        kind: 'authorization',
        client_source: 'gateway',
        in: 'security',
        name: 'connection_key',
        issuer: gatewayIssuer,
        scope: 'messages:read messages:write',
      },
      says: {
        'messages:read': 'Read the messages of the workspace.',
        'messages:write': 'Post messages in the workspace.',
      },
      added_by: caller,
    },
    context: acted,
  },
  {
    type: 'connection_consent_started',
    data: {
      ...ofTheConnection,
      state_sha256: 'e5f6a7',
      verifier_secret_id: 'secret-8',
      client_id: 'gateway-client-1',
      client_source: 'gateway',
      expires_at: '2026-10-29T10:10:00.000Z',
      scope: 'messages:read messages:write',
      says: {},
    },
    context: acted,
  },
  {
    type: 'connection_connected',
    data: {
      ...ofTheConnection,
      secret_id: 'secret-9',
      client_id: 'gateway-client-1',
      client_source: 'gateway',
      scope: 'messages:read messages:write',
      account: { id: 'A0001', name: 'Test Account' },
      connected_by: caller,
    },
    context: acted,
  },
];
