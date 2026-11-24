import { Schema, Struct } from 'effect';

import { ProviderEntrySchema, type ProviderEntry } from '../entry/provider-entry.ts';

const decodeEntry = Schema.decodeUnknownSync(ProviderEntrySchema);

export const signingInToMail = {
  kind: 'authorization',
  account_types: ['service', 'personal'],
  issuer: 'https://login.mail.example.com/common',
  scope: 'mail.readwrite',
  says: { 'mail.readwrite': 'Read and send the mail of the account.' },
  description: 'Sign in to Mail and allow Auto to read and send your mail.',
} as const;

export const asTheCompanysApp = {
  kind: 'client_credentials',
  issuer: 'https://login.mail.example.com/{tenant}',
  scope: 'mail.all',
  says: { 'mail.all': 'Read and send the mail of the mailboxes the app reaches.' },
  placeholders: {
    tenant: {
      title: 'Directory ID',
      description: 'The ID of your directory at Mail.',
      pattern: '^[0-9a-f]{8}$',
      example: '0a1b2c3d',
    },
    mailbox: {
      title: 'Mailbox',
      description: 'The mailbox the app works in.',
      pattern: '^[^@\\s]+@[^@\\s]+$',
      example: 'robot@acme.example.com',
    },
  },
  base_url: 'https://api.mail.example.com/v1/mailboxes/{mailbox}',
  key_page: 'https://admin.mail.example.com/apps',
  key_page_title: 'Open the apps of Mail',
  client_id_title: 'Application ID',
  description: 'The ID and secret of an app your company registers at Mail.',
} as const;

export const agentServerAddress = {
  title: 'Server address',
  description: 'The address of your company’s agent server.',
  format: 'uri',
  example: 'https://agents.acme.example.com/mcp',
} as const;

export const asARegisteredClient = {
  kind: 'secret',
  permissions: 'application',
  in: 'header',
  name: 'Authorization',
  scheme: 'Bearer',
  description: 'Client API key',
  instructions: 'Register a client on the **Clients** page, and copy its API key.',
  key_page: 'https://admin.agents.example.com/clients',
} as const;

export const agents: ProviderEntry = decodeEntry({
  name: 'agents',
  title: 'Agents',
  description: 'Use the services your company connected to its own agent server.',
  website: 'https://developer.agents.example.com',
  type: 'mcp',
  url: '{address}',
  placeholders: { address: agentServerAddress },
  credentials: [asARegisteredClient],
});

export const asAServiceAccount = {
  kind: 'jwt_bearer',
  issuer: 'https://login.mail.example.com',
  scope: 'mail.read',
  says: { 'mail.read': 'Read the mail of the mailbox.' },
  subject: '{inbox}',
  placeholders: {
    inbox: {
      title: 'Mailbox',
      description: 'The service account reads mail in this mailbox.',
      pattern: '^[^@\\s]+@[^@\\s]+$',
      example: 'inbox@acme.example.com',
    },
  },
  key_file: { client_id: '/client_email', private_key: '/private_key' },
  key_page: 'https://admin.mail.example.com/service-accounts',
  key_page_title: 'Open the service accounts of Mail',
  steps: {
    key_page: { title: 'Create a service account at Mail', instructions: 'Create a service account and a key for it.' },
    pages: [
      {
        title: 'Allow it at Mail',
        instructions: 'Allow the service account to read mail.',
        page: 'https://admin.mail.example.com/delegation',
        page_title: 'Open the admin console of Mail',
      },
    ],
    key: { title: 'Enter the details here', instructions: 'Choose the key file and name the mailbox.' },
  },
  description: 'A service account your company creates at Mail.',
} as const;

export const asTheServiceAccountItself = {
  ...Struct.omit(asAServiceAccount, ['subject', 'placeholders', 'steps', 'description']),
  steps: {
    key_page: asAServiceAccount.steps.key_page,
    pages: [
      {
        title: 'Add it as a user at Mail',
        instructions: 'Add the service account as a user of the mailboxes it reads.',
        page: 'https://admin.mail.example.com/users',
        page_title: 'Open the users of Mail',
      },
    ],
    key: { title: 'Enter the details here', instructions: 'Choose the key file.' },
  },
  description: 'A service account your company creates at Mail, acting as itself.',
} as const;

export const installedAppRequest = {
  method: 'POST',
  url: 'https://api.mail.example.com/apps/installations/{installation}/tokens',
  issued: { access_token: '/token', expires_at: '/expires_at' },
} as const;

export const asAnInstalledApp = {
  kind: 'jwt_bearer',
  issuer: 'https://api.mail.example.com/apps',
  client_id: '{app}',
  key_file: { format: 'pem' },
  token_request: installedAppRequest,
  placeholders: {
    app: { title: 'App ID', description: 'The ID of the app at Mail.', pattern: '^[0-9]+$', example: '1234567' },
    installation: {
      title: 'Installation ID',
      description: 'The ID of the app where it is installed.',
      pattern: '^[0-9]+$',
      example: '12345678',
    },
  },
  key_page: 'https://admin.mail.example.com/apps',
  key_page_title: 'Open the apps of Mail',
  steps: {
    key_page: { title: 'Register an app at Mail', instructions: 'Register an app and create its private key.' },
    key: { title: 'Enter the details here', instructions: 'Choose the private key and enter the two IDs.' },
  },
  limitation: 'It can’t reach a mailbox until it is installed on it.',
  description: 'The ID, private key and installation of an app your company registers at Mail.',
} as const;

export const asAnInstallingApp = {
  kind: 'authorization',
  permissions: 'application',
  issuer: 'https://login.mail.example.com/common',
  clients: ['registered'],
  installation: {
    issuer: 'https://api.mail.example.com/apps',
    installations: {
      method: 'GET',
      url: 'https://api.mail.example.com/apps/user/installations',
      list: '/installations',
      id: '/id',
      name: '/account/name',
      account: '/account/id',
      personal: { '/account/kind': ['person'] },
    },
    userinfo: { method: 'GET', url: 'https://api.mail.example.com/apps/me', id: '/id' },
    membership: {
      method: 'GET',
      url: 'https://api.mail.example.com/apps/me/memberships/{account_name}',
      admin: { '/role': ['owner'], '/status': ['joined'] },
    },
    returned: { installation: 'installation', requested: { action: ['request'] } },
    token_request: {
      method: 'POST',
      url: 'https://api.mail.example.com/apps/installations/{installation_id}/tokens',
      issued: { access_token: '/token', expires_at: '/expires_at' },
    },
  },
  limitation: 'It reaches only the mailboxes the app is installed on.',
  description: 'The app whoever runs Auto registered at Mail, installed on your mailboxes.',
} as const;

export const mail: ProviderEntry = decodeEntry({
  name: 'mail',
  title: 'Mail',
  description: 'Read and send the mail of one mailbox.',
  website: 'https://developer.mail.example.com',
  type: 'openapi',
  document: 'https://mail.example.com/openapi.json',
  base_url: 'https://api.mail.example.com/v1/self',
  credentials: [signingInToMail, asTheCompanysApp],
});

const exchangedFor = {
  token_endpoint: 'https://sts.mail.example.com/v1/token',
  audience: '//identity.mail.example.com/projects/{project}/pools/auto/providers/auto',
  subject_token: {
    type: 'urn:ietf:params:oauth:token-type:jwt',
    audience: 'https://identity.mail.example.com/projects/{project}/pools/auto/providers/auto',
  },
  scope: 'mail.read',
  says: { 'mail.read': 'Read the mail of the mailboxes the account reaches.' },
  parameters: {
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: 'https://mail.example.com/auth/platform',
  },
  impersonation: {
    method: 'POST',
    url: 'https://credentials.mail.example.com/v1/accounts/{account}:token',
    request: { scope: '/scope' },
    issued: { access_token: '/accessToken', expires_at: '/expireTime' },
  },
  placeholders: {
    project: {
      title: 'Project number',
      description: 'The number of your project at Mail.',
      pattern: '^[0-9]{6,20}$',
      example: '123456789012',
    },
    account: {
      title: 'Service account email',
      description: 'The email of the service account the connection acts as.',
      pattern: '^[^@\\s]+@[^@\\s]+$',
      example: 'robot@acme.example.com',
    },
  },
  test: { tool: 'mailboxes_list', reached: { list: '/mailboxes', name: '/address' } },
} as const;

export const asTheCompanysServiceAccount = {
  kind: 'token_exchange',
  ...exchangedFor,
  key_page: 'https://admin.mail.example.com/identity',
  key_page_title: 'Open the identity page of Mail',
  steps: {
    key_page: {
      title: 'Trust Auto at Mail',
      instructions: 'Add a provider with the issuer {issuer}, and let the subject {subject} act as {account}.',
    },
    key: { title: 'Enter the details here', instructions: 'Enter the project number and the account.' },
  },
  description: 'A service account your company creates at Mail, without a key.',
} as const;

export const asAManagedServiceAccount = {
  kind: 'token_exchange',
  ...exchangedFor,
  managed_service_account: true,
  read_only: true,
  limitation: 'It only reads.',
  description: 'A service account Auto creates at Mail for the connection.',
} as const;
