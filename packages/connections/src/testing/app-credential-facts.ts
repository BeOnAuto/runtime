import type { ConnectionEventSchema } from '../registry/connection-events.ts';

export const heldAppCredentials: readonly (typeof ConnectionEventSchema.Type)[] = [
  {
    type: 'connection_connected',
    data: {
      connection: 'connection-1',
      secret_id: 'secret-11',
      app_secret_ids: { app_level_token: 'secret-12' },
      connected_by: { id: 'key_7f3a', name: 'key_7f3a' },
    },
    context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
  },
  {
    type: 'connection_app_credential_refused',
    data: {
      connection: 'connection-1',
      name: 'app_level_token',
      reason:
        'The provider refused the Chat app-level token this connection holds, so replies are checked on a timer, not at once. Reconnect the connection to give a new one.',
    },
    context: { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' },
  },
];
