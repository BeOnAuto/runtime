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
