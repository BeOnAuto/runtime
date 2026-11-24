import { readFileSync } from 'node:fs';

import { ContextSchema, type ProjectedKeyedRow, type ProjectedMessage, type ProjectedRow } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import { drive, messages, providerListOf, providerOf } from '@on.auto/providers/testing';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { registryOfRows } from './connection-rows-read.ts';
import { connectionRows } from './connection-rows.ts';
import { connectionsFoldOf } from './registry-decider.ts';

const decodeFact = Schema.decodeUnknownSync(ConnectionEventSchema);

const storedFactOf = Schema.decodeUnknownSync(
  Schema.Struct({ type: Schema.String, data: Schema.Unknown, context: ContextSchema }),
);

function storedIn(release: string, type: string): unknown {
  return JSON.parse(readFileSync(new URL(`./${release}/${type}.json`, import.meta.url), 'utf8'));
}

const connectionsStream = {
  kind: 'connections',
  id: 'connections',
  scope: 'org',
  prefix: 'org/acme/',
  address: { org: 'acme' },
} as const;

const laterRelease = [
  ['0.54.0', 'connection_link_issued'],
  ['0.60.0', 'connection_consent_started'],
  ['0.60.0', 'connection_connected'],
  ['0.67.0', 'connection_app_credential_refused'],
  ['0.71.0', 'connection_identified'],
  ['0.72.0', 'connection_place_named'],
  ['0.72.0', 'connection_model_set'],
  ['0.71.0', 'connection_requested'],
  ['0.71.0', 'connection_request_declined'],
  ['0.72.0', 'connection_link_issued'],
] as const;

const histories: readonly (readonly (readonly [string, string])[])[] = [
  [['0.46.0', 'connection_added'], ...laterRelease],
  [['0.49.0', 'connection_added'], ...laterRelease, ['0.70.0', 'connection_account_type_set']],
  [['0.60.0', 'connection_added'], ['0.70.0', 'connection_way_chosen'], ...laterRelease],
  [
    ['0.60.0', 'connection_added'],
    ['0.60.0', 'connection_connected'],
    ['0.72.0', 'connection_way_chosen'],
  ],
  [['0.70.0', 'connection_added'], ...laterRelease],
  [['0.73.0', 'connection_added'], ...laterRelease],
  [
    ['0.71.0', 'connection_added'],
    ['0.70.0', 'connection_account_type_set'],
  ],
  [['0.73.0', 'connection_added'], ['0.73.0', 'connection_service_account_created'], ...laterRelease],
  [
    ['0.60.0', 'connection_added'],
    ['0.60.0', 'connection_connected'],
    ['0.73.0', 'connection_next_way_chosen'],
  ],
  [
    ['0.60.0', 'connection_added'],
    ['0.60.0', 'connection_connected'],
    ['0.73.0', 'connection_next_way_chosen'],
    ['0.49.0', 'connection_client_given'],
    ['0.60.0', 'connection_consent_started'],
    ['0.73.0', 'connection_service_account_created'],
    ['0.72.0', 'connection_way_chosen'],
    ['0.60.0', 'connection_connected'],
  ],
  [
    ['0.46.0', 'connection_added'],
    ['0.60.0', 'connection_connected'],
    ['0.73.0', 'connection_next_way_chosen'],
    ...laterRelease,
  ],
  [
    ['0.60.0', 'connection_added'],
    ['0.60.0', 'connection_connected'],
    ['0.73.0', 'connection_next_way_chosen'],
    ['0.73.0', 'connection_consent_started'],
  ],
  [
    ['0.60.0', 'connection_added'],
    ['0.73.0', 'connection_consent_started'],
  ],
  [
    ['0.60.0', 'connection_added'],
    ['0.60.0', 'connection_connected'],
    ['0.73.0', 'connection_next_way_chosen'],
    ['0.73.0', 'connection_consent_started'],
    ['0.72.0', 'connection_way_chosen'],
    ['0.57.0', 'connection_playbooks_set'],
    ['0.60.0', 'connection_connected'],
  ],
];

function rowsAfter(stored: readonly unknown[]): readonly ProjectedKeyedRow[] {
  const rows = new Map<string, ProjectedRow>();
  for (const [index, fact] of stored.entries()) {
    const { type, data, context } = storedFactOf(fact);
    const message: ProjectedMessage = { id: `m${index}`, position: index + 1, type, data, context };
    const key = connectionRows.keyOf?.(message, connectionsStream);
    const after = key === undefined ? undefined : connectionRows.rowAfter(rows.get(key), message);
    if (key !== undefined && after !== undefined) {
      rows.set(key, after);
    }
  }
  return [...rows].map(([key, row]: readonly [string, ProjectedRow]) => ({ org: 'acme', key, row }));
}

function foldedOver(providers: ProviderList, facts: readonly RecordedConnectionEvent[]) {
  const { evolve, initialState } = connectionsFoldOf(providers);
  return facts.reduce((registry, fact) => evolve(registry, fact), initialState);
}

const [messagesWay] = messages.credentials;

const providerLists: readonly (readonly [string, ProviderList])[] = [
  ['none', providerListOf()],
  ['files', providerListOf(providerOf({ ...drive, name: 'files' }))],
  ['messages', providerListOf(providerOf(messages))],
  ['messages renamed chat', providerListOf(providerOf({ ...messages, name: 'chat', aliases: ['messages'] }))],
  [
    'messages acting as the app',
    providerListOf(
      providerOf({
        ...messages,
        credentials: [{ ...messagesWay, permissions: 'application' }],
      }),
    ),
  ],
];

describe('the connections of an org, kept as a row each in the transaction of every append', () => {
  it.each(
    histories.flatMap((history) =>
      providerLists.map(
        ([named, providers]) =>
          [
            `${String(history[0]?.[0])} over ${history.length} facts, with the providers ${named}`,
            providers,
            history,
          ] as const,
      ),
    ),
  )('read, for a connection first recorded by release %s, as the stream folds', (_recorded, providers, history) => {
    const stored = history.map(([release, type]) => storedIn(release, type));

    expect(registryOfRows(rowsAfter(stored), providers)).toEqual(
      foldedOver(
        providers,
        stored.map((fact) => decodeFact(fact)),
      ),
    );
  });

  it('change no row for a fact about a connection the org does not have, or a fact they cannot read', () => {
    const [connected] = rowsAfter([]);
    const fact = storedFactOf(storedIn('0.60.0', 'connection_connected'));
    const unread = { id: 'm1', position: 1, type: 'connection_added', data: {}, context: fact.context };

    expect([
      connected,
      connectionRows.rowAfter(undefined, { id: 'm1', position: 1, ...fact }),
      connectionRows.rowAfter(undefined, unread),
      connectionRows.keyOf?.(unread, connectionsStream),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

const keptBeforeServiceAccounts =
  '{"connection":{"id":"connection-1","name":"mail","type":"openapi","provider":"mail","placeholders":{},"entry":{"document":"https://mail.example.com/openapi.json","base_url":"https://api.mail.example.com/v1/self"},"account_type":null,"status":"connected","added_by":{"id":"person:ada","name":"Ada Lovelace"},"added_at":"2026-10-29T10:00:00.000Z","request":null,"connected_at":"2026-10-29T10:00:00.000Z","connected_by":{"id":"person:ada","name":"Ada Lovelace"},"asked_scopes":[{"name":"mail.read","says":"Read the mail of the mailbox."}],"granted_scope":null,"granted_scopes":null,"broken":null,"signing_secret":null,"account":null,"app_credentials":[],"installation":{"id":"41","name":"acme"},"credential":{"kind":"jwt_bearer","permissions":"application","issuer":"https://login.mail.example.com","client_id":"auto-runtime","scope":"mail.read","client_source":"registered"}},"replaced_links":[],"app_secret_ids":{},"model":null,"place_names":[]}';

describe('a row of a connection the release before kept, with no service account', () => {
  it('reads as the stream folds, and folds a service account created after it as the stream does', () => {
    const stored = [storedIn('0.73.0', 'connection_added'), storedIn('0.73.0', 'connection_connected')];
    const created = storedFactOf(storedIn('0.73.0', 'connection_service_account_created'));
    const before = {
      kept: keptBeforeServiceAccounts,
      added_position: 1,
      credential_as_added: true,
      account_type_as_added: true,
    };
    const after = connectionRows.rowAfter(before, { id: 'm3', position: 3, ...created });
    const providers = providerListOf();

    expect([
      registryOfRows([{ org: 'acme', key: 'connection-1', row: before }], providers),
      registryOfRows(
        [{ org: 'acme', key: 'connection-1', row: Option.getOrThrow(Option.fromNullishOr(after)) }],
        providers,
      ),
    ]).toEqual([
      foldedOver(
        providers,
        stored.map((fact) => decodeFact(fact)),
      ),
      foldedOver(
        providers,
        [...stored, created].map((fact) => decodeFact(fact)),
      ),
    ]);
  });
});
