import { readFileSync } from 'node:fs';

import { type ActedContext, ActedContextSchema, factOf, RecordedCallerSchema, recordingOf } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import { messagesThrough, providerListOf, providerOf } from '@on.auto/providers/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand, PlaybooksChoice } from './connection-commands.ts';
import { ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
import { type ConnectionEvent, ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { type Credential, CredentialSchema } from './credential.ts';
import { connectionsFoldOf, registryDeciderOf } from './registry-decider.ts';
import { evolveRegistry, initialRegistry, newestFirst, type Registry } from './registry.ts';

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
    data: { connection: '0199-crm', token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z' },
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

function foldedAsRecorded(facts: readonly RecordedConnectionEvent[]): Registry {
  return facts.reduce((registry, fact) => evolveRegistry(registry, fact), initialRegistry);
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
  data: { connection: 'crm-id', token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z' },
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
        credential: { kind: 'secret', name: 'Authorization', in: 'header' },
        status: 'pending',
        added_by: { id: 'person:ada', name: 'Ada Lovelace' },
        added_at: '2026-10-15T14:00:00.000Z',
        connected_at: null,
        connected_by: null,
        asked_scopes: [],
        granted_scope: null,
        granted_scopes: null,
        broken: null,
        signing_secret: null,
        account: null,
      },
      link: { token_sha256: 'a1b2', expires_at: '2026-10-16T14:00:00.000Z' },
      replacedLinks: new Set(),
      secretId: undefined,
      algorithm: undefined,
      signing: undefined,
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

describe('a later link of a connection, as the stream folds it', () => {
  it('takes the place of the one before, keeping the digest of one it replaced and none of one used up', () => {
    const nextLink: ConnectionEvent = {
      type: 'connection_link_issued',
      data: { connection: '0199-crm', token_sha256: 'c3d4', expires_at: '2026-10-16T14:05:00.000Z' },
    };

    expect(crmAfter(nextLink)).toMatchObject({
      link: { token_sha256: 'c3d4', expires_at: '2026-10-16T14:05:00.000Z' },
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
      { kind: 'client_credentials', issuer },
      { kind: 'client_credentials', issuer, client_id: 'acme' },
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

describe('a consent made through a gateway, as a release before the gateway reads it', () => {
  it('is not read, since the gateway is a source of a client that release does not know, so the readers ship before anything writes it', () => {
    expect([
      Result.isFailure(readBefore(recordedIn('0.60.0/connection_connected.json'))),
      Result.isFailure(startedBefore(recordedIn('0.60.0/connection_consent_started.json'))),
    ]).toEqual([true, true]);
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
      lists.map(() => histories.map((facts) => foldedAsRecorded(facts))),
    );
  });
});

describe('a connection added under a name its provider declares as another of its names', () => {
  it('is folded under the provider’s name now, its document beside the entries the provider’s now, all else as recorded', () => {
    const asRecorded = connectionIn(foldedAsRecorded([jottingsAdded]), 'connection-of-jottings');

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

    expect(filesNow).toEqual({ ...connectionIn(foldedAsRecorded([ofFiles]), 'connection-1'), provider: 'drive' });
    expect(messagesNow).toEqual({ ...connectionIn(foldedAsRecorded([ofMessages]), 'connection-1'), provider: 'relay' });
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
