import { isOfItsSealedValues, type OfItsSealedValues, type RecordedConnectionEvent } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';
import { appCredentialsAfter } from './kept-app-credentials.ts';
import { isOfItsServiceAccount, serviceAccountCreatedAfter, type KeptServiceAccount } from './kept-service-accounts.ts';
import { signingRemoved, signingSet, signingShown, type KeptSigning } from './kept-signing.ts';

interface Keeping extends KeptServiceAccount {
  readonly connection: RecordedConnection;
  readonly signing: KeptSigning | undefined;
}

type OfItsKeptValues = OfItsSealedValues | Parameters<typeof serviceAccountCreatedAfter>[1];

export function isOfItsKeptValues(event: RecordedConnectionEvent): event is OfItsKeptValues {
  return isOfItsSealedValues(event) || isOfItsServiceAccount(event);
}

function withSigning<Kept extends Keeping>(kept: Kept, signing: KeptSigning | undefined): Kept {
  return { ...kept, signing, connection: { ...kept.connection, signing_secret: signingShown(signing) } };
}

export function withItsKeptValues<Kept extends Keeping>(kept: Kept, event: OfItsKeptValues): Kept {
  if (event.type === 'connection_service_account_created') {
    return serviceAccountCreatedAfter(kept, event);
  }
  if (event.type === 'connection_signing_secret_set') {
    return withSigning(kept, signingSet(kept.signing, event));
  }
  return event.type === 'connection_signing_secret_removed'
    ? withSigning(kept, signingRemoved(kept.signing, event))
    : {
        ...kept,
        connection: {
          ...kept.connection,
          app_credentials: appCredentialsAfter(kept.connection.app_credentials, event),
        },
      };
}
