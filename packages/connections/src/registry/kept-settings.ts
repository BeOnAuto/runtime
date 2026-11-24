import { entryServing, type ConnectionEntry } from './connection-entry.ts';
import type {
  AccountTypeSet,
  ModelSet,
  PlaybooksSet,
  RecordedConnectionEvent,
  WayChosen,
} from './connection-events.ts';
import { scopesSaid, type RecordedConnection } from './connection.ts';
import { actsAsAManagedServiceAccount } from './exchange-credentials.ts';
import { withoutItsServiceAccount, type KeptServiceAccount } from './kept-service-accounts.ts';

export type Setting = PlaybooksSet | AccountTypeSet | WayChosen | ModelSet;

const typesOfSettings: ReadonlySet<string> = new Set([
  'connection_playbooks_set',
  'connection_account_type_set',
  'connection_way_chosen',
  'connection_model_set',
]);

interface Settable extends KeptServiceAccount {
  readonly connection: RecordedConnection;
  readonly consent: unknown;
  readonly clientSecretId: string | undefined;
  readonly nextClient: unknown;
  readonly model: string | null;
}

export function isASetting(event: RecordedConnectionEvent): event is Setting {
  return typesOfSettings.has(event.type);
}

export function entryAt(entry: ConnectionEntry, baseUrl: string | null | undefined): ConnectionEntry {
  if (baseUrl === undefined) {
    return entry;
  }
  const { base_url: _replaced, ...elsewhere } = entry;
  return baseUrl === null ? elsewhere : { ...elsewhere, base_url: baseUrl };
}

export function wayChosenAfter<Kept extends Settable>(kept: Kept, { data }: Pick<WayChosen, 'data'>): Kept {
  const { credential, account_type: accountType, says, placeholders, base_url: baseUrl } = data;
  const before = actsAsAManagedServiceAccount(credential) ? kept : withoutItsServiceAccount(kept);
  return {
    ...before,
    connection: {
      ...before.connection,
      ...(placeholders === undefined ? {} : { placeholders }),
      entry: entryAt(before.connection.entry, baseUrl),
      credential,
      account_type: accountType ?? null,
      asked_scopes: scopesSaid(credential.scope, says),
    },
    consent: undefined,
    clientSecretId: undefined,
    nextClient: undefined,
  };
}

function connectionSet(connection: RecordedConnection, setting: PlaybooksSet | AccountTypeSet): RecordedConnection {
  return setting.type === 'connection_playbooks_set'
    ? { ...connection, entry: entryServing(connection.entry, setting.data.playbooks) }
    : { ...connection, account_type: setting.data.account_type };
}

export function settingAfter<Kept extends Settable>(kept: Kept, setting: Setting): Kept {
  if (setting.type === 'connection_model_set') {
    return { ...kept, model: setting.data.model };
  }
  return setting.type === 'connection_way_chosen'
    ? wayChosenAfter(kept, setting)
    : { ...kept, connection: connectionSet(kept.connection, setting) };
}
