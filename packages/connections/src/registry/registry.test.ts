import { readFileSync } from 'node:fs';

import { type ActedContext, ActedContextSchema, factOf, RecordedCallerSchema, recordingOf } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import { messagesThrough, providerListOf, providerOf } from '@on.auto/providers/testing';
import { ClientSourceSchema } from '@on.auto/tool-servers';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand, PlaybooksChoice } from './connection-commands.ts';
import { ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
import { type ConnectionEvent, ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { AccountSchema } from './connection.ts';
import { type Credential, CredentialSchema } from './credential.ts';
import { connectionsFoldOf, registryDeciderOf } from './registry-decider.ts';
import { evolveRegistry, initialRegistry, newestFirst, type Registry } from './registry.ts';
import { factsAsTheyAct } from './what-connections-act-as.ts';

const registryDecider = registryDeciderOf(providerListOf());

const recorded = recordingOf(registryDecider.eventSchema);

const added: ActedContext = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const later: ActedContext = { by: 'person:grace', at: '2026-10-15T14:05:00.000Z' };

const crm = {
  connection: '0199-crm',
  name: 'crm',
  server_type: 'mcp',
  provider: null,
  placeholders: null,
  entry: { url: 'https://crm.example.com/mcp', headers: { 'X-Tenant': 'acme-eu' } },
  credential: { kind: 'secret', name: 'Authorization', in: 'header' },
  says: {},
  added_by: { id: 'person:ada', name: 'Ada Lovelace' },
} as const;

const crmAdded: ConnectionEvent = { type: 'connection_added', data: crm };

const history: readonly ConnectionEvent[] = [
  crmAdded,
  {
    type: 'connection_link_issued',
    data: { connection: '0199-crm', token_sha256: 'a1b2' },
  },
];

const approval: ConnectionEvent = { type: 'connection_approved', data: { connection: '0199-crm' } };

const connection: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: '0199-crm', secret_id: 'secret-1', connected_by: { id: 'person:grace', name: 'Grace Hopper' } },
};

function evolvedWith(registry: Registry, event: ConnectionEvent, context: ActedContext): Registry {
  return registryDecider.evolve(registry, recorded(event, context));
}

function crmAfter(...events: readonly ConnectionEvent[]) {
  const registry = history.reduce((state, event) => evolvedWith(state, event, added), registryDecider.initialState);
  return events.reduce((state, event) => evolvedWith(state, event, later), registry).get('0199-crm');
}

const issuer = 'https://auth.billing.example.com';

function credentialAfter(...events: readonly ConnectionEvent[]) {
  const registry = events.reduce((state, event) => evolvedWith(state, event, later), registryDecider.initialState);
  return registry.get('0199-billing')?.connection.credential;
}

const filesRead = 'Read the files of the account.';

const AddedBeforeTheDocument = factOf(
  'connection_added',
  Schema.Struct({
    connection: Schema.String,
    name: Schema.String,
    server_type: ConnectionTypeSchema,
    provider: Schema.NullOr(Schema.String),
    placeholders: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
    entry: ConnectionEntrySchema,
    credential: CredentialSchema,
    says: Schema.Record(Schema.String, Schema.String),
    added_by: RecordedCallerSchema,
  }),
  ActedContextSchema,
);

const recordedAddedBeforeDocument: unknown = JSON.parse(
  readFileSync(new URL('0.59.0/connection_added.json', import.meta.url), 'utf8'),
);

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

const ConnectedBeforeTheAppCredentials = factOf(
  'connection_connected',
  Schema.Struct({
    connection: Schema.String,
    secret_id: Schema.optionalKey(Schema.String),
    algorithm: Schema.optionalKey(Schema.String),
    client_id: Schema.optionalKey(Schema.String),
    client_source: Schema.optionalKey(ClientSourceSchema),
    scope: Schema.optionalKey(Schema.String),
    account: Schema.optionalKey(AccountSchema),
    connected_by: RecordedCallerSchema,
  }),
  ActedContextSchema,
);

function recordedIn(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

const readBefore = Schema.decodeUnknownResult(Schema.toCodecJson(ConnectedBeforeTheAccount));

const startedBefore = Schema.decodeUnknownResult(Schema.toCodecJson(StartedBeforeTheGateway));

const factOfFactsAsNamed = Schema.decodeUnknownSync(Schema.toCodecJson(ConnectionEventSchema));

function recordedInFactsAsNamed(release: string): RecordedConnectionEvent {
  return factOfFactsAsNamed(
    JSON.parse(readFileSync(new URL(`./${release}/connection_added.json`, import.meta.url), 'utf8')),
  );
}

const recordedAdditions: readonly RecordedConnectionEvent[] = ['0.46.0', '0.49.0', '0.57.0', '0.59.0', '0.60.0'].map(
  (release) => recordedInFactsAsNamed(release),
);

const files = {
  name: 'files',
  title: 'Files',
  description: 'Read the files of an account.',
  website: 'https://developer.files.example.com',
  type: 'mcp',
  url: 'https://mcp.files.example.com/mcp',
  credentials: [{ kind: 'none' }],
};

const notesEntry = {
  name: 'notes',
  title: 'Notes',
  description: 'Read and write the notes of a team.',
  website: 'https://developer.notes.example.com',
  type: 'openapi',
  document: 'documents/notes.openapi.json',
  credentials: [{ kind: 'none' }],
};

const notes = providerOf({ ...notesEntry, aliases: ['jottings'] }, 'https://api.notes.example.com/v1');

const jottingsAdded = factOfFactsAsNamed({
  type: 'connection_added',
  data: {
    connection: 'connection-of-jottings',
    name: 'team-notes',
    server_type: 'openapi',
    provider: 'jottings',
    placeholders: {},
    entry: { document: 'documents/jottings.openapi.json', playbooks: ['weekly'] },
    credential: { kind: 'none' },
    says: {},
    added_by: { id: 'person:ada', name: 'Ada Lovelace' },
  },
  context: { at: '2026-11-01T09:00:00.000Z', by: 'person:ada' },
});

function foldedAsRecorded(facts: readonly RecordedConnectionEvent[], providers = providerListOf()): Registry {
  const asTheyAct = factsAsTheyAct(providers);
  return facts.reduce((registry, fact) => evolveRegistry(registry, asTheyAct(fact)), initialRegistry);
}

function foldedWith(providers: ProviderList, facts: readonly RecordedConnectionEvent[]): Registry {
  const { evolve, initialState } = connectionsFoldOf(providers);
  return facts.reduce((registry, fact) => evolve(registry, fact), initialState);
}

function connectionIn(registry: Registry, id: string) {
  return registry.get(id)?.connection;
}

const histories: readonly (readonly RecordedConnectionEvent[])[] = [...recordedAdditions, jottingsAdded].map(
  (fact): readonly RecordedConnectionEvent[] => [fact],
);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const ada = { id: 'person:ada', name: 'Ada Lovelace' };

function addedWith(credential: Credential): ConnectionEvent {
  return {
    type: 'connection_added',
    data: {
      connection: 'crm-id',
      name: 'crm',
      server_type: 'mcp',
      provider: null,
      placeholders: null,
      entry: { url: 'https://crm.example.com/mcp', playbooks: ['sales'] },
      credential,
      says: {},
      added_by: ada,
    },
  };
}

const linkIssued: ConnectionEvent = {
  type: 'connection_link_issued',
  data: { connection: 'crm-id', token_sha256: 'a1b2' },
};

const linkUse = { connection: 'crm-id', token_sha256: 'a1b2', bindsPerson: true };

function decided(command: ConnectionCommand, credential: Credential) {
  const registry = [addedWith(credential), linkIssued].reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

interface Acting {
  readonly by?: string;
  readonly token_sha256?: string;
}

function approving(choice: PlaybooksChoice, acting: Acting = {}): ConnectionCommand {
  return { type: 'approve', ...linkUse, connected_by: ada, ...choice, ...acted, ...acting };
}

function giving(choice: PlaybooksChoice, acting: Acting = {}): ConnectionCommand {
  return { type: 'give', ...linkUse, connected_by: ada, secret_id: 'secret-1', ...choice, ...acted, ...acting };
}

function starting(choice: PlaybooksChoice, acting: Acting = {}): ConnectionCommand {
  return {
    type: 'start',
    ...linkUse,
    state_sha256: 'c3d4',
    verifier_secret_id: 'secret-2',
    client_id: 'auto-runtime',
    client_source: 'registered',
    expires_at: '2026-10-15T14:10:00.000Z',
    scope: undefined,
    says: {},
    ...choice,
    ...acted,
    ...acting,
  };
}

const takingNone: Credential = { kind: 'none' };

const takingASecret: Credential = { kind: 'secret', name: 'Authorization', in: 'header' };

const byConsent: Credential = { kind: 'authorization', issuer: 'https://auth.crm.example.com', clients: ['dynamic'] };

function setTo(playbooks: readonly string[] | null): ConnectionEvent {
  return { type: 'connection_playbooks_set', data: { connection: 'crm-id', playbooks } };
}

const approved: ConnectionEvent = { type: 'connection_approved', data: { connection: 'crm-id' } };

const connected: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: 'crm-id', connected_by: ada },
};

const connectedWithItsSecret: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: 'crm-id', secret_id: 'secret-1', connected_by: ada },
};

describe('an added connection, as the stream folds it', () => {
  it('is pending, added by the caller its fact names, by id and name, with its link open', () => {
    expect(crmAfter()).toEqual({
      connection: {
        id: '0199-crm',
        name: 'crm',
        type: 'mcp',
        provider: null,
        placeholders: null,
        entry: { url: 'https://crm.example.com/mcp', headers: { 'X-Tenant': 'acme-eu' } },
        credential: { kind: 'secret', name: 'Authorization', in: 'header', permissions: 'delegated' },
        account_type: 'personal',
        status: 'pending',
        added_by: { id: 'person:ada', name: 'Ada Lovelace' },
        added_at: '2026-10-15T14:00:00.000Z',
        request: null,
        connected_at: null,
        connected_by: null,
        asked_scopes: [],
        granted_scope: null,
        granted_scopes: null,
        broken: null,
        signing_secret: null,
        account: null,
        app_credentials: [],
      },
      link: { token_sha256: 'a1b2' },
      replacedLinks: new Set(),
      secretId: undefined,
      algorithm: undefined,
      signing: undefined,
      appSecretIds: {},
      placeNames: new Map(),
    });
  });

  it('takes an approval, then a connection with its secret, which closes the link', () => {
    expect(crmAfter(approval)).toMatchObject({ connection: { status: 'pending' }, link: { token_sha256: 'a1b2' } });
    expect(crmAfter(approval, connection)).toMatchObject({
      connection: {
        status: 'connected',
        connected_at: '2026-10-15T14:05:00.000Z',
        connected_by: { id: 'person:grace', name: 'Grace Hopper' },
        broken: null,
      },
      link: undefined,
      secretId: 'secret-1',
    });
  });
});

function identifiedAt(connectedAt: string, id = '7001'): ConnectionEvent {
  return {
    type: 'connection_identified',
    data: { connection: '0199-crm', connected_at: connectedAt, user: { id, name: 'sam' } },
  };
}

describe('the account a connection acts as, as the stream folds it', () => {
  it('is kept beside the connection for its connecting, and the record a read answers is the same with or without it', () => {
    const identified = crmAfter(approval, connection, identifiedAt(later.at));

    expect(identified?.identified).toEqual({ id: '7001', name: 'sam' });
    expect(identified?.connection).toEqual(crmAfter(approval, connection)?.connection);
  });

  it('is cleared by a new connecting, and an answer of an earlier connecting changes nothing', () => {
    const anHourBefore = '2026-10-15T13:05:00.000Z';

    expect([
      crmAfter(approval, connection, identifiedAt(later.at), connection)?.identified,
      crmAfter(approval, connection, identifiedAt(anHourBefore))?.identified,
      crmAfter(approval, connection, identifiedAt(later.at), identifiedAt(anHourBefore, '9'))?.identified,
      crmAfter(identifiedAt(later.at))?.identified,
    ]).toEqual([undefined, undefined, { id: '7001', name: 'sam' }, undefined]);
  });
});

const posted = 'com.example.chat.post';

function placeNamedAt(connectedAt: string, subject: string, name: string): ConnectionEvent {
  return {
    type: 'connection_place_named',
    data: { connection: '0199-crm', connected_at: connectedAt, event_type: posted, subject, name },
  };
}

function namesOf(kept: ReturnType<typeof crmAfter>) {
  return [...(kept?.placeNames ?? new Map<string, ReadonlyMap<string, string>>())].map(
    ([type, named]: readonly [string, ReadonlyMap<string, string>]) => [type, Object.fromEntries(named)],
  );
}

describe('the names of the places a connection reaches, as the stream folds them', () => {
  it('are kept beside the connection for its connecting, each place by its type, the newest name of each, and the record a read answers is the same with or without them', () => {
    const named = crmAfter(
      approval,
      connection,
      placeNamedAt(later.at, 'C1', 'support'),
      placeNamedAt(later.at, 'C2', 'sales'),
      placeNamedAt(later.at, 'C1', 'help'),
    );

    expect(namesOf(named)).toEqual([[posted, { C1: 'help', C2: 'sales' }]]);
    expect(named?.connection).toEqual(crmAfter(approval, connection)?.connection);
  });

  it('pass over a name of another connecting, are cleared by a new connecting, and are kept as the connection breaks', () => {
    const anHourBefore = '2026-10-15T13:05:00.000Z';
    const support = placeNamedAt(later.at, 'C1', 'support');
    const broken: ConnectionEvent = {
      type: 'connection_broken',
      data: { connection: '0199-crm', kind: 'credential_refused', reason: 'Refused' },
    };

    expect([
      namesOf(crmAfter(approval, connection, placeNamedAt(anHourBefore, 'C1', 'support'))),
      namesOf(crmAfter(approval, connection, support, connection)),
      namesOf(crmAfter(approval, connection, support, broken)),
      namesOf(crmAfter(support)),
    ]).toEqual([[], [], [[posted, { C1: 'support' }]], []]);
  });
});

function identifiedInSpace(connectedAt: string, space: string): ConnectionEvent {
  return {
    type: 'connection_identified',
    data: { connection: '0199-crm', connected_at: connectedAt, user: { id: '7001' }, account: { id: space } },
  };
}

const signedInForItsAccount: ConnectionEvent = {
  type: 'connection_connected',
  data: {
    connection: '0199-crm',
    secret_id: 'secret-1',
    account: { id: 'T-1', name: 'Acme' },
    connected_by: { id: 'person:grace', name: 'Grace Hopper' },
  },
};

describe('the account a connection is in, as the answer for its connecting folds it', () => {
  it('becomes the account the answer names where the connecting named none, kept apart from the account it acts as', () => {
    const identified = crmAfter(approval, connection, identifiedInSpace(later.at, 'S-0042'));

    expect([identified?.connection.account, identified?.identified]).toEqual([{ id: 'S-0042' }, { id: '7001' }]);
  });

  it('never replaces the account a connecting named, is cleared by a new connecting, and an answer of an earlier connecting changes nothing', () => {
    const anHourBefore = '2026-10-15T13:05:00.000Z';
    const inSpace = identifiedInSpace(later.at, 'S-0042');

    expect([
      crmAfter(approval, signedInForItsAccount, inSpace)?.connection.account,
      crmAfter(approval, connection, inSpace, connection)?.connection.account,
      crmAfter(approval, connection, identifiedInSpace(anHourBefore, 'S-0042'))?.connection.account,
      crmAfter(approval, connection, inSpace, identifiedInSpace(anHourBefore, 'S-9'))?.connection.account,
    ]).toEqual([{ id: 'T-1', name: 'Acme' }, null, null, { id: 'S-0042' }]);
  });
});

describe('a later link of a connection, as the stream folds it', () => {
  it('takes the place of the one before, keeping the digest of one it replaced and none of one used up', () => {
    const nextLink: ConnectionEvent = {
      type: 'connection_link_issued',
      data: { connection: '0199-crm', token_sha256: 'c3d4' },
    };

    expect(crmAfter(nextLink)).toMatchObject({
      link: { token_sha256: 'c3d4' },
      replacedLinks: new Set(['a1b2']),
    });
    expect(crmAfter(approval, connection, nextLink)?.replacedLinks).toEqual(new Set());
  });
});

describe('a connected connection, as the stream folds it', () => {
  it('takes a break with its kind, its sentence and its time, and a removal, which keeps the id of the secret to forget', () => {
    const breaking: ConnectionEvent = {
      type: 'connection_broken',
      data: { connection: '0199-crm', kind: 'credential_gone', reason: 'Its credential is gone' },
    };
    const removal: ConnectionEvent = { type: 'connection_removed', data: { connection: '0199-crm' } };

    expect(crmAfter(connection, breaking)).toMatchObject({
      connection: {
        status: 'broken',
        broken: { kind: 'credential_gone', detail: 'Its credential is gone', at: '2026-10-15T14:05:00.000Z' },
      },
    });
    expect(crmAfter(connection, removal)).toMatchObject({
      connection: { status: 'removed', broken: null },
      secretId: 'secret-1',
    });
  });
});

describe('the playbooks of a connection, as the stream folds them', () => {
  it('are those a later fact names, and every playbook again for null, the entry then naming none', () => {
    const toSales: ConnectionEvent = {
      type: 'connection_playbooks_set',
      data: { connection: '0199-crm', playbooks: ['sales'] },
    };
    const toEvery: ConnectionEvent = {
      type: 'connection_playbooks_set',
      data: { connection: '0199-crm', playbooks: null },
    };

    expect(crmAfter(toSales)).toMatchObject({
      connection: {
        status: 'pending',
        entry: { url: 'https://crm.example.com/mcp', headers: { 'X-Tenant': 'acme-eu' }, playbooks: ['sales'] },
      },
      link: { token_sha256: 'a1b2' },
    });
    expect(crmAfter(toSales, toEvery)?.connection.entry).toEqual({
      url: 'https://crm.example.com/mcp',
      headers: { 'X-Tenant': 'acme-eu' },
    });
  });
});

describe('the registry of connections', () => {
  it('leaves out a fact of a connection it never added, and lists the connections newest first', () => {
    const wiki: ConnectionEvent = { type: 'connection_added', data: { ...crm, connection: '0199-wiki', name: 'wiki' } };
    const stray: ConnectionEvent = { type: 'connection_removed', data: { connection: 'nowhere' } };
    const registry = [crmAdded, wiki, stray].reduce(
      (state, event) => evolvedWith(state, event, later),
      registryDecider.initialState,
    );

    expect(newestFirst(registry).map((kept) => kept.connection.name)).toEqual(['wiki', 'crm']);
    expect(registry.has('nowhere')).toBe(false);
  });
});

describe('a connection of client credentials whose client id is given on the page, as the stream folds it', () => {
  it('holds no client id while it is pending, and the one its connection names once it is connected', () => {
    const billing: ConnectionEvent = {
      type: 'connection_added',
      data: {
        connection: '0199-billing',
        name: 'billing',
        server_type: 'openapi',
        provider: null,
        placeholders: null,
        entry: { document: 'https://billing.example.com/openapi.json' },
        credential: { kind: 'client_credentials', issuer },
        says: {},
        added_by: { id: 'person:ada', name: 'Ada Lovelace' },
      },
    };
    const connectedWithItsClient: ConnectionEvent = {
      type: 'connection_connected',
      data: {
        connection: '0199-billing',
        secret_id: 'secret-2',
        client_id: 'acme',
        connected_by: { id: 'person:grace', name: 'Grace Hopper' },
      },
    };

    expect([credentialAfter(billing), credentialAfter(billing, connectedWithItsClient)]).toEqual([
      { kind: 'client_credentials', issuer, permissions: 'application' },
      { kind: 'client_credentials', issuer, client_id: 'acme', permissions: 'application' },
    ]);
  });
});

describe('the scopes of a connection of consent, as the stream folds it', () => {
  it('are those its credential asks, in its words, and those granted, in the words of those asked or bare', () => {
    const drive: ConnectionEvent = {
      type: 'connection_added',
      data: {
        ...crm,
        connection: '0199-drive',
        name: 'drive',
        provider: 'drive',
        placeholders: {},
        credential: {
          kind: 'authorization',
          issuer: 'https://accounts.drive.example.com',
          scope: 'files.read files.write',
        },
        says: { 'files.read': filesRead, 'files.write': 'Create and change the files of the account.' },
      },
    };
    const granted: ConnectionEvent = {
      type: 'connection_connected',
      data: {
        connection: '0199-drive',
        secret_id: 'secret-3',
        scope: 'files.read offline_access',
        connected_by: { id: 'person:grace', name: 'Grace Hopper' },
      },
    };
    const registry = [drive, granted].reduce(
      (state, event) => evolvedWith(state, event, later),
      registryDecider.initialState,
    );

    expect(registry.get('0199-drive')?.connection).toMatchObject({
      asked_scopes: [
        { name: 'files.read', says: filesRead },
        { name: 'files.write', says: 'Create and change the files of the account.' },
      ],
      granted_scope: 'files.read offline_access',
      granted_scopes: [
        { name: 'files.read', says: filesRead },
        { name: 'offline_access', says: null },
      ],
    });
  });
});

describe('a connection added with its document whole, as a release before the member reads it', () => {
  it('reads the fact recorded in 0.59.0 through that release’s schema, passing over the document it does not know', () => {
    const read = Schema.decodeUnknownSync(Schema.toCodecJson(AddedBeforeTheDocument))(recordedAddedBeforeDocument);

    expect(read).toEqual({
      type: 'connection_added',
      data: {
        connection: 'connection-1',
        name: 'ledgers',
        server_type: 'openapi',
        provider: null,
        placeholders: null,
        entry: { base_url: 'https://api.ledgers.example.com/v1' },
        credential: {
          kind: 'secret',
          name: 'X-Ledgers-Key',
          in: 'header',
          instructions: 'Make a key under [Settings, API keys](https://ledgers.example.com/settings/keys).',
          key_page: 'https://ledgers.example.com/settings/keys',
        },
        says: {},
        added_by: { id: 'key_7f3a', name: 'key_7f3a' },
      },
      context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
    });
  });
});

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

const IdentifiedBeforeTheAccount = factOf(
  'connection_identified',
  Schema.Struct({
    connection: Schema.String,
    connected_at: Schema.String,
    user: Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) }),
  }),
  ActedContextSchema,
);

describe('the answer for a connecting that names the account it is in, as a release before the member reads it', () => {
  it('reads the fact recorded in 0.71.0 through that release’s schema, passing over the account it does not know', () => {
    const readBeforeTheAccount = Schema.decodeUnknownResult(Schema.toCodecJson(IdentifiedBeforeTheAccount));

    expect(Result.getOrThrow(readBeforeTheAccount(recordedIn('0.71.0/connection_identified.json')))).toEqual({
      type: 'connection_identified',
      data: { connection: 'connection-1', connected_at: '2026-10-29T10:00:00.000Z', user: { id: '7001', name: 'sam' } },
      context: { at: '2026-10-29T10:00:00.000Z', by: 'runtime' },
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

describe('a connection connected with further values of its app, as a release before the member reads it', () => {
  it('reads the fact recorded in 0.67.0 through that release’s schema, passing over the ids it does not know', () => {
    const readBeforeTheAppCredentials = Schema.decodeUnknownResult(
      Schema.toCodecJson(ConnectedBeforeTheAppCredentials),
    );

    expect(Result.getOrThrow(readBeforeTheAppCredentials(recordedIn('0.67.0/connection_connected.json')))).toEqual({
      type: 'connection_connected',
      data: { connection: 'connection-1', secret_id: 'secret-11', connected_by: { id: 'key_7f3a', name: 'key_7f3a' } },
      context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
    });
  });
});

const tokenOfTheApp = 'app_level_token';

const givenWithItsApp: ConnectionCommand = {
  type: 'give',
  ...linkUse,
  connected_by: ada,
  secret_id: 'secret-1',
  app_secret_ids: { [tokenOfTheApp]: 'secret-2', signing_secret: 'secret-3' },
  ...acted,
};

function afterTheGiving(...more: readonly ConnectionEvent[]): Registry {
  const facts = [addedWith(takingASecret), linkIssued, ...Result.getOrThrow(decided(givenWithItsApp, takingASecret))];
  return [...facts, ...more].reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, later)),
    registryDecider.initialState,
  );
}

function refusing(name: string, connectedAt = later.at): ConnectionCommand {
  return {
    type: 'refuse_app_credential',
    connection: 'crm-id',
    connected_at: connectedAt,
    name,
    reason: 'The service refuses it',
    ...later,
  };
}

const refusedOnce: ConnectionEvent = {
  type: 'connection_app_credential_refused',
  data: { connection: 'crm-id', name: tokenOfTheApp, reason: 'The service refuses it' },
};

describe('the app credentials a connection holds, as the stream folds them', () => {
  it('are recorded by id in the connection, shown by name, and none where none is given', () => {
    expect([
      Result.map(decided(givenWithItsApp, takingASecret), (events) => events.at(-1)),
      Result.map(decided(giving({}), takingASecret), (events) => events.at(-1)),
    ]).toEqual([
      Result.succeed({
        type: 'connection_connected',
        data: {
          connection: 'crm-id',
          secret_id: 'secret-1',
          app_secret_ids: { [tokenOfTheApp]: 'secret-2', signing_secret: 'secret-3' },
          connected_by: ada,
        },
      }),
      Result.succeed(connectedWithItsSecret),
    ]);
    expect(afterTheGiving().get('crm-id')).toMatchObject({
      connection: {
        app_credentials: [
          { name: tokenOfTheApp, refused: null },
          { name: 'signing_secret', refused: null },
        ],
      },
      appSecretIds: { [tokenOfTheApp]: 'secret-2', signing_secret: 'secret-3' },
    });
  });

  it('are refused only while the connection is connected as the refusal saw it and holds one not refused yet', () => {
    const registry = afterTheGiving();

    expect([
      registryDecider.decide(refusing(tokenOfTheApp), registry),
      registryDecider.decide(refusing('socket_token'), registry),
      registryDecider.decide(refusing(tokenOfTheApp, '2026-10-15T13:00:00.000Z'), registry),
      registryDecider.decide(refusing(tokenOfTheApp), afterTheGiving(refusedOnce)),
    ]).toEqual([Result.succeed([refusedOnce]), Result.succeed([]), Result.succeed([]), Result.succeed([])]);
  });

  it('show a refusal by name until the connection is connected again or removed, and forget none of their ids at a refusal', () => {
    const reconnected: ConnectionEvent = {
      type: 'connection_connected',
      data: { connection: 'crm-id', secret_id: 'secret-3', connected_by: ada },
    };
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'crm-id' } };

    expect([
      afterTheGiving(refusedOnce).get('crm-id'),
      afterTheGiving(refusedOnce, reconnected).get('crm-id'),
      afterTheGiving(removed).get('crm-id'),
    ]).toMatchObject([
      {
        connection: {
          status: 'connected',
          app_credentials: [
            { name: tokenOfTheApp, refused: { detail: 'The service refuses it', at: later.at } },
            { name: 'signing_secret', refused: null },
          ],
        },
        appSecretIds: { [tokenOfTheApp]: 'secret-2', signing_secret: 'secret-3' },
      },
      { connection: { app_credentials: [] }, appSecretIds: {} },
      {
        connection: { status: 'removed', app_credentials: [] },
        appSecretIds: { [tokenOfTheApp]: 'secret-2', signing_secret: 'secret-3' },
      },
    ]);
  });
});

describe('the connections of an org, folded where no provider declares another name', () => {
  it('are each fact as it was recorded, whatever providers the runtime has', () => {
    const lists: readonly ProviderList[] = [
      providerListOf(),
      providerListOf(
        providerOf(files),
        providerOf(messagesThrough()),
        providerOf(notesEntry, 'https://api.notes.example.com/v1'),
      ),
    ];

    expect(lists.map((providers) => histories.map((facts) => foldedWith(providers, facts)))).toEqual(
      lists.map((providers) => histories.map((facts) => foldedAsRecorded(facts, providers))),
    );
  });
});

describe('a connection added under a name its provider declares as another of its names', () => {
  it('is folded under the provider’s name now, its document beside the entries the provider’s now, all else as recorded', () => {
    const asRecorded = connectionIn(foldedAsRecorded([jottingsAdded], providerListOf(notes)), 'connection-of-jottings');

    expect(connectionIn(foldedWith(providerListOf(notes), [jottingsAdded]), 'connection-of-jottings')).toEqual({
      ...asRecorded,
      provider: 'notes',
      entry: { document: 'documents/notes.openapi.json', playbooks: ['weekly'] },
    });
  });

  it('keeps its own name, the server it reaches by address and an entry with no document as recorded', () => {
    const renamed = providerListOf(
      providerOf({ ...messagesThrough(), name: 'relay', aliases: ['messages'] }),
      providerOf({ ...files, name: 'drive', aliases: ['files'] }),
    );
    const ofFiles = recordedInFactsAsNamed('0.49.0');
    const ofMessages = recordedInFactsAsNamed('0.60.0');
    const filesNow = connectionIn(foldedWith(renamed, [ofFiles]), 'connection-1');
    const messagesNow = connectionIn(foldedWith(renamed, [ofMessages]), 'connection-1');

    expect(filesNow).toEqual({
      ...connectionIn(foldedAsRecorded([ofFiles], renamed), 'connection-1'),
      provider: 'drive',
    });
    expect(messagesNow).toEqual({
      ...connectionIn(foldedAsRecorded([ofMessages], renamed), 'connection-1'),
      provider: 'relay',
    });
    expect([filesNow?.name, filesNow?.entry, messagesNow?.name, messagesNow?.entry]).toEqual([
      'files',
      { url: 'https://mcp.files.example.com/mcp' },
      'messages',
      { document: 'https://gateway.messages.example.com/openapi.json' },
    ]);
  });
});

describe('an approval that names the playbooks that may use the connection', () => {
  it('records them before the approval, in the same decision, where they differ from those its entry names', () => {
    expect([
      decided(approving({ playbooks: ['support'] }), takingNone),
      decided(approving({ playbooks: null }), takingNone),
      decided(approving({ playbooks: ['sales'] }), takingNone),
      decided(approving({}), takingNone),
    ]).toEqual([
      Result.succeed([setTo(['support']), approved, connected]),
      Result.succeed([setTo(null), approved, connected]),
      Result.succeed([approved, connected]),
      Result.succeed([approved, connected]),
    ]);
  });

  it('is taken by a credential given and a consent started alike', () => {
    expect([
      decided(giving({ playbooks: ['support'] }), takingASecret),
      decided(giving({ playbooks: ['sales'] }), takingASecret),
      Result.map(decided(starting({ playbooks: ['support'] }), byConsent), (events) => events.map(({ type }) => type)),
      Result.map(decided(starting({ playbooks: ['sales'] }), byConsent), (events) => events.map(({ type }) => type)),
    ]).toEqual([
      Result.succeed([setTo(['support']), approved, connectedWithItsSecret]),
      Result.succeed([approved, connectedWithItsSecret]),
      Result.succeed(['connection_playbooks_set', 'connection_consent_started']),
      Result.succeed(['connection_consent_started']),
    ]);
  });
});

describe('an approval refused that names playbooks', () => {
  it('records nothing, whether another person approves or the token is not the link’s', () => {
    expect([
      decided(approving({ playbooks: ['support'] }, { by: 'person:grace' }), takingNone),
      decided(giving({ playbooks: ['support'] }, { token_sha256: 'e5f6' }), takingASecret),
      decided(starting({ playbooks: ['support'] }, { by: 'person:grace' }), byConsent),
    ]).toMatchObject([
      Result.fail({ _tag: 'forbidden' }),
      Result.fail({ _tag: 'not_found' }),
      Result.fail({ _tag: 'forbidden' }),
    ]);
  });
});

const aMomentOn = '2026-10-15T14:00:01.000Z';

const yearsOn = '2031-10-15T14:00:00.000Z';

const yearsAndFiveMinutesOn = '2031-10-15T14:05:00.000Z';

function foldedAt(...facts: readonly (readonly [ConnectionEvent, string])[]): Registry {
  return facts.reduce(
    (state, [event, at]) => registryDecider.evolve(state, recorded(event, { by: 'person:ada', at })),
    registryDecider.initialState,
  );
}

const anyFacts: unknown = expect.any(Array);

const taken = Result.succeed(anyFacts);

const notFound = Result.fail({ _tag: 'not_found' });

const newerLink: ConnectionEvent = {
  type: 'connection_link_issued',
  data: { connection: 'crm-id', token_sha256: 'e5f6' },
};

const consentStarted: ConnectionEvent = {
  type: 'connection_consent_started',
  data: {
    connection: 'crm-id',
    state_sha256: 'c3d4',
    verifier_secret_id: 'secret-2',
    client_id: 'auto-runtime',
    client_source: 'registered',
    expires_at: '2031-10-15T14:10:00.000Z',
    says: {},
  },
};

const finishing: ConnectionCommand = {
  type: 'finish',
  ...linkUse,
  connected_by: ada,
  state_sha256: 'c3d4',
  secret_id: 'secret-3',
  client_id: 'auto-runtime',
  client_source: 'registered',
  by: 'person:ada',
  at: yearsAndFiveMinutesOn,
};

function connectionLinkedThen(event: ConnectionEvent): Registry {
  return foldedAt([addedWith(takingNone), acted.at], [linkIssued, acted.at], [event, aMomentOn]);
}

const byConsentLinked: readonly (readonly [ConnectionEvent, string])[] = [
  [addedWith(byConsent), acted.at],
  [linkIssued, acted.at],
];

describe('the link of a connection, as a decision looks it up', () => {
  it.each([
    ['a moment after its fact', acted.at, aMomentOn],
    ['years after its fact', acted.at, yearsOn],
    ['before the moment its fact holds', yearsOn, acted.at],
  ])('is taken %s, by an approval, a credential given and a start of its consent', (_, issuedAt, at) => {
    const linked = (credential: Credential) => foldedAt([addedWith(credential), issuedAt], [linkIssued, issuedAt]);

    expect([
      registryDecider.decide({ ...approving({}), at }, linked(takingNone)),
      registryDecider.decide({ ...giving({}), at }, linked(takingASecret)),
      registryDecider.decide({ ...starting({}), at }, linked(byConsent)),
    ]).toMatchObject([taken, taken, taken]);
  });

  it('is refused once its connection is connected or removed, or a newer link replaced it, and the newer link is taken', () => {
    const approvingYearsOn = { ...approving({}), at: yearsOn };
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'crm-id' } };

    expect([
      registryDecider.decide(approvingYearsOn, connectionLinkedThen(connected)),
      registryDecider.decide(approvingYearsOn, connectionLinkedThen(removed)),
      registryDecider.decide(approvingYearsOn, connectionLinkedThen(newerLink)),
      registryDecider.decide(
        { ...approving({}, { token_sha256: 'e5f6' }), at: yearsOn },
        connectionLinkedThen(newerLink),
      ),
    ]).toMatchObject([notFound, notFound, notFound, taken]);
  });

  it('is the same for a start of consent and its finish, which take a link years on and refuse one a newer link replaced', () => {
    const startingYearsOn = { ...starting({}), at: yearsOn };

    expect([
      registryDecider.decide(startingYearsOn, foldedAt(...byConsentLinked)),
      registryDecider.decide(finishing, foldedAt(...byConsentLinked, [consentStarted, yearsOn])),
      registryDecider.decide(startingYearsOn, foldedAt(...byConsentLinked, [newerLink, yearsOn])),
      registryDecider.decide(finishing, foldedAt(...byConsentLinked, [consentStarted, yearsOn], [newerLink, yearsOn])),
    ]).toMatchObject([taken, taken, notFound, notFound]);
  });
});
