import type {
  ClientGiven,
  ConnectionAdded,
  ConnectionEvent,
  ConsentStarted,
  NextWayChosen,
  RecordedConnectionEvent,
  WayChosen,
} from './connection-events.ts';
import { wordsOf, type RecordedConnection } from './connection.ts';
import type { KeptServiceAccount } from './kept-service-accounts.ts';
import { entryAt, wayChosenAfter } from './kept-settings.ts';
import type { KeptConnection, StartedConsent } from './registry.ts';

export interface NextWay extends KeptServiceAccount {
  readonly credential: RecordedConnection['credential'];
  readonly account_type: RecordedConnection['account_type'];
  readonly asked_scopes: RecordedConnection['asked_scopes'];
  readonly placeholders: RecordedConnection['placeholders'];
  readonly base_url: string | undefined;
  readonly consent: StartedConsent | undefined;
  readonly clientSecretId: string | undefined;
}

type ServiceAccountCreated = Extract<RecordedConnectionEvent, { readonly type: 'connection_service_account_created' }>;

type OfTheNextWay = ClientGiven | ConsentStarted | ServiceAccountCreated | WayChosen;

type Evolved<Event> = (kept: KeptConnection, event: Event) => KeptConnection;

type FoldedOnItsWay = Exclude<RecordedConnectionEvent, ConnectionAdded | NextWayChosen>;

const typesOfTheNextWay: ReadonlySet<string> = new Set([
  'connection_client_given',
  'connection_consent_started',
  'connection_service_account_created',
  'connection_way_chosen',
]);

function isOfTheNextWay(event: RecordedConnectionEvent): event is OfTheNextWay {
  return typesOfTheNextWay.has(event.type);
}

function connectionOfTheWay(connection: RecordedConnection, nextWay: NextWay): RecordedConnection {
  const { service_account: _itsOwn, ...withoutAnAccount } = connection;
  const { serviceAccount } = nextWay;
  return {
    ...withoutAnAccount,
    credential: nextWay.credential,
    account_type: nextWay.account_type,
    asked_scopes: nextWay.asked_scopes,
    placeholders: nextWay.placeholders,
    entry: entryAt(connection.entry, nextWay.base_url ?? null),
    ...(serviceAccount === undefined ? {} : { service_account: { email: serviceAccount.email } }),
  };
}

export function asItConnects<Kept extends KeptConnection>(kept: Kept): Kept {
  const { nextWay } = kept;
  if (nextWay === undefined) {
    return kept;
  }
  return {
    ...kept,
    connection: connectionOfTheWay(kept.connection, nextWay),
    consent: nextWay.consent,
    secretId: undefined,
    algorithm: undefined,
    clientSecretId: nextWay.clientSecretId,
    nextClient: undefined,
    appSecretIds: {},
    serviceAccount: nextWay.serviceAccount,
  };
}

function nextWayOf({ connection, consent, clientSecretId, serviceAccount }: KeptConnection): NextWay {
  return {
    credential: connection.credential,
    account_type: connection.account_type,
    asked_scopes: connection.asked_scopes,
    placeholders: connection.placeholders,
    base_url: connection.entry.base_url,
    consent,
    clientSecretId,
    serviceAccount,
  };
}

function connectingOf(kept: KeptConnection): KeptConnection {
  return { ...asItConnects(kept), nextWay: undefined };
}

function isUnderTheClientItRunsUnder({ connection }: KeptConnection, { credential }: NextWayChosen['data']): boolean {
  return credential.client_id !== undefined && credential.client_id === connection.credential.client_id;
}

function nextWayChosenAfter(kept: KeptConnection, { data }: NextWayChosen): KeptConnection {
  const connecting = connectingOf(kept);
  const chosen = wayChosenAfter(connecting, { data });
  const clientSecretId = isUnderTheClientItRunsUnder(connecting, data) ? connecting.clientSecretId : undefined;
  return { ...kept, consent: undefined, nextWay: nextWayOf({ ...chosen, clientSecretId }) };
}

function nextWayTaken(kept: KeptConnection, { data }: WayChosen): KeptConnection {
  const connecting = connectingOf(kept);
  const { credential, account_type: accountType, placeholders, base_url: baseUrl } = data;
  return {
    ...connecting,
    connection: {
      ...connecting.connection,
      ...(placeholders === undefined ? {} : { placeholders }),
      entry: entryAt(connecting.connection.entry, baseUrl),
      credential,
      account_type: accountType ?? null,
    },
  };
}

function nextWayAfter(kept: KeptConnection, event: OfTheNextWay, evolved: Evolved<OfTheNextWay>): KeptConnection {
  return event.type === 'connection_way_chosen'
    ? nextWayTaken(kept, event)
    : { ...kept, nextWay: nextWayOf(evolved(connectingOf(kept), event)) };
}

export function evolvedWithItsNextWay(
  evolved: Evolved<FoldedOnItsWay>,
): Evolved<Exclude<RecordedConnectionEvent, ConnectionAdded>> {
  return (kept, event) => {
    if (event.type === 'connection_next_way_chosen') {
      return nextWayChosenAfter(kept, event);
    }
    return kept.nextWay !== undefined && isOfTheNextWay(event)
      ? nextWayAfter(kept, event, evolved)
      : evolved(kept, event);
  };
}

export function nextWayTakenOf({ connection, nextWay }: KeptConnection): readonly ConnectionEvent[] {
  if (nextWay === undefined) {
    return [];
  }
  const { credential, account_type: accountType, asked_scopes: askedScopes, placeholders } = nextWay;
  return [
    {
      type: 'connection_way_chosen',
      data: {
        connection: connection.id,
        credential,
        ...(accountType === null ? {} : { account_type: accountType }),
        says: wordsOf(askedScopes),
        ...(placeholders === null ? {} : { placeholders }),
        base_url: nextWay.base_url ?? null,
      },
    },
  ];
}
