import type { ConnectionEventSchema } from '../registry/connection-events.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

const caller = { id: 'key_7f3a', name: 'key_7f3a' };

const ofTheConnection = { connection: 'connection-1' };

export const actingAsAnAccount: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'tracker',
      server_type: 'mcp',
      provider: 'tracker',
      placeholders: { site: 'acme' },
      entry: { url: 'https://acme.tracker.example.com/mcp' },
      credential: {
        kind: 'secret',
        permissions: 'delegated',
        name: 'Authorization',
        in: 'header',
        scheme: 'Bearer',
        instructions: 'Make a key under [Settings, API keys](https://tracker.example.com/settings/keys).',
        key_page: 'https://tracker.example.com/settings/keys',
      },
      account_type: 'service',
      says: {},
      added_by: caller,
    },
    context: acted,
  },
  {
    type: 'connection_account_type_set',
    data: { ...ofTheConnection, account_type: 'personal' },
    context: acted,
  },
];

const issuer = 'https://auth.files.example.com';

const signingIn = {
  kind: 'authorization',
  permissions: 'delegated',
  issuer,
  clients: ['dynamic'],
  scope: 'files.read',
} as const;

const asTheApp = { kind: 'client_credentials', permissions: 'application', issuer, scope: 'files.read' } as const;

export const wayChosenAgain: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_way_chosen',
    data: {
      ...ofTheConnection,
      credential: {
        kind: 'authorization',
        permissions: 'delegated',
        issuer: 'https://accounts.drive.example.com',
        scope: 'files.read',
      },
      account_type: 'service',
      says: { 'files.read': 'Read the files of the account.' },
    },
    context: acted,
  },
];

export const keptWaysOfAServer: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'files',
      server_type: 'mcp',
      provider: null,
      placeholders: null,
      entry: { url: 'https://mcp.files.example.com/mcp' },
      credential: signingIn,
      ways: [signingIn, asTheApp],
      account_type: 'personal',
      says: {},
      added_by: caller,
    },
    context: acted,
  },
];
