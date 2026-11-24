import type { RecordedConnectionEvent } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';

type ServiceAccountCreated = Extract<RecordedConnectionEvent, { readonly type: 'connection_service_account_created' }>;

type CreatedServiceAccount = Omit<ServiceAccountCreated['data'], 'connection'>;

export interface KeptServiceAccount {
  readonly serviceAccount: CreatedServiceAccount | undefined;
}

export function isOfItsServiceAccount(event: RecordedConnectionEvent): event is ServiceAccountCreated {
  return event.type === 'connection_service_account_created';
}

export function serviceAccountCreatedAfter<
  Kept extends KeptServiceAccount & { readonly connection: RecordedConnection },
>(kept: Kept, { data }: ServiceAccountCreated): Kept {
  const { email, id, placeholders } = data;
  return {
    ...kept,
    connection: { ...kept.connection, service_account: { email } },
    serviceAccount: { email, id, placeholders },
  };
}

export function withoutItsServiceAccount<Kept extends KeptServiceAccount & { readonly connection: RecordedConnection }>(
  kept: Kept,
): Kept {
  const { service_account: _removed, ...connection } = kept.connection;
  return { ...kept, connection, serviceAccount: undefined };
}
