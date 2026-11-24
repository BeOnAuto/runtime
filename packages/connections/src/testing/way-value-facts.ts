import type { ConnectionEventSchema } from '../registry/connection-events.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

const ofTheConnection = { connection: 'connection-1' };

export const wayChosenWithItsValues: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_way_chosen',
    data: {
      ...ofTheConnection,
      credential: {
        kind: 'client_credentials',
        permissions: 'application',
        issuer: 'https://login.mail.example.com/0a1b2c3d',
        scope: 'mail.all',
      },
      says: { 'mail.all': 'Read and send the mail of the mailboxes the app reaches.' },
      placeholders: { tenant: '0a1b2c3d', mailbox: 'robot@acme.example.com' },
      base_url: 'https://api.mail.example.com/v1/mailboxes/robot@acme.example.com',
    },
    context: acted,
  },
];

export const addedAsAServiceAccount: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'mail',
      server_type: 'openapi',
      provider: 'mail',
      placeholders: { inbox: 'inbox@acme.example.com' },
      entry: { document: 'https://mail.example.com/openapi.json', base_url: 'https://api.mail.example.com/v1/self' },
      credential: {
        kind: 'jwt_bearer',
        permissions: 'application',
        issuer: 'https://login.mail.example.com',
        scope: 'mail.read',
        subject: 'inbox@acme.example.com',
      },
      says: { 'mail.read': 'Read the mail of the mailbox.' },
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: acted,
  },
];

const addedActingAsItself: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'mail',
      server_type: 'openapi',
      provider: 'mail',
      placeholders: {},
      entry: { document: 'https://mail.example.com/openapi.json', base_url: 'https://api.mail.example.com/v1/self' },
      credential: {
        kind: 'jwt_bearer',
        permissions: 'application',
        issuer: 'https://login.mail.example.com',
        scope: 'mail.read',
      },
      says: { 'mail.read': 'Read the mail of the mailbox.' },
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: acted,
  },
];

const wayChosenAsAnInstalledApp: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_way_chosen',
    data: {
      ...ofTheConnection,
      credential: {
        kind: 'jwt_bearer',
        permissions: 'application',
        issuer: 'https://api.mail.example.com/apps',
        client_id: '1234567',
        token_request: {
          method: 'POST',
          url: 'https://api.mail.example.com/apps/installations/12345678/tokens',
          issued: { access_token: '/token', expires_at: '/expires_at' },
        },
      },
      says: {},
      placeholders: { app: '1234567', installation: '12345678' },
    },
    context: acted,
  },
];

const connectedThroughAnInstallation: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_connected',
    data: {
      ...ofTheConnection,
      client_id: 'auto-runtime',
      client_source: 'registered',
      installation: { id: '41', name: 'acme' },
      connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: acted,
  },
];

const serviceAccountCreated: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_service_account_created',
    data: {
      ...ofTheConnection,
      email: 'auto-4k2m9q@connections.mail.example.com',
      id: '104857600000000000001',
      placeholders: { project: '123456789012', account: 'auto-4k2m9q@connections.mail.example.com' },
    },
    context: acted,
  },
];

const nextWayChosen: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_next_way_chosen',
    data: {
      ...ofTheConnection,
      credential: {
        kind: 'jwt_bearer',
        permissions: 'application',
        issuer: 'https://api.mail.example.com/apps',
        client_id: '1234567',
        token_request: {
          method: 'POST',
          url: 'https://api.mail.example.com/apps/installations/12345678/tokens',
          issued: { access_token: '/token', expires_at: '/expires_at' },
        },
      },
      says: {},
      placeholders: { app: '1234567', installation: '12345678' },
      base_url: 'https://api.mail.example.com/v1',
    },
    context: acted,
  },
];

const startedForTheNextWay: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_consent_started',
    data: {
      ...ofTheConnection,
      state_sha256: 'b8c9d0',
      verifier_secret_id: 'secret-9',
      client_id: 'auto-runtime',
      client_source: 'registered',
      expires_at: '2026-10-29T10:10:00.000Z',
      scope: 'mail.read',
      says: {},
      playbooks: ['sales', 'support'],
    },
    context: acted,
  },
];

export const actingAsTheApp = [
  ...addedActingAsItself,
  ...wayChosenAsAnInstalledApp,
  ...connectedThroughAnInstallation,
  ...serviceAccountCreated,
  ...nextWayChosen,
  ...startedForTheNextWay,
];

const exchangingForTheCompany = {
  kind: 'token_exchange',
  permissions: 'application',
  token_endpoint: 'https://sts.mail.example.com/v1/token',
  scope: 'mail.read',
  parameters: {
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: 'https://mail.example.com/auth/platform',
  },
} as const;

const exchangeSays = { 'mail.read': 'Read the mail of the mailboxes the account reaches.' };

/**
 * A connection added, a way chosen, and a way chosen for a connection that is connected, through a way that exchanges a
 * token with none of the way's own values, which the page its link opens asks after its steps: the same facts and
 * members as before, their values empty, as those of a service account Auto manages already were (a weak schema).
 */
export const leftToThePage: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'mail',
      server_type: 'openapi',
      provider: 'mail',
      placeholders: {},
      entry: { document: 'https://mail.example.com/openapi.json', base_url: 'https://api.mail.example.com/v1/self' },
      credential: exchangingForTheCompany,
      says: exchangeSays,
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: acted,
  },
  {
    type: 'connection_way_chosen',
    data: {
      ...ofTheConnection,
      credential: exchangingForTheCompany,
      says: exchangeSays,
      placeholders: {},
      base_url: 'https://api.mail.example.com/v1/self',
    },
    context: acted,
  },
  {
    type: 'connection_next_way_chosen',
    data: {
      ...ofTheConnection,
      credential: exchangingForTheCompany,
      says: exchangeSays,
      placeholders: {},
      base_url: 'https://api.mail.example.com/v1/self',
    },
    context: acted,
  },
];

const grantedForTheAccount = {
  kind: 'client_credentials',
  permissions: 'application',
  issuer: 'https://login.meetings.example.com',
  parameters: { grant_type: 'account_credentials', account_id: 'acct-7f3a' },
} as const;

export const extensionGrantFacts: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_added',
    data: {
      ...ofTheConnection,
      name: 'meetings',
      server_type: 'openapi',
      provider: 'meetings',
      placeholders: { account_id: 'acct-7f3a' },
      entry: { document: 'https://meetings.example.com/openapi.json' },
      credential: grantedForTheAccount,
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: acted,
  },
  {
    type: 'connection_way_chosen',
    data: {
      ...ofTheConnection,
      credential: grantedForTheAccount,
      says: {},
      placeholders: { account_id: 'acct-7f3a' },
    },
    context: acted,
  },
];
