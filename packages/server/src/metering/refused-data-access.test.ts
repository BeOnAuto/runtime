import { describe, expect, it } from 'vitest';

import { accountsServed, servedBy, type Accounts } from '../testing/accounts/licensed-server.ts';
import type { ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { tallied } from '../testing/servers/tally-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const listening = workflowSource(
  'listening',
  "do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.approved } } } }, output: { as: '${ $data[0] }' } }\n",
);

const later = workflowSource('later', 'do:\n  - done:\n      set: { done: true }\n');

interface Refusing {
  readonly kind: string;
  readonly refuse: (accounts: Accounts, server: ReasoningServer) => Promise<unknown>;
}

const refusals: readonly Refusing[] = [
  {
    kind: 'credits_exhausted',
    refuse: ({ account }) => {
      account.exhaust();
      return Promise.resolve();
    },
  },
  {
    kind: 'license_invalid',
    refuse: ({ account, key }, server) => {
      account.revoke(key, 'installation_revoked');
      return tallied(server);
    },
  },
  {
    kind: 'meter_unavailable',
    refuse: ({ account }) => {
      account.goDown();
      return Promise.resolve();
    },
  },
  {
    kind: 'account_closed',
    refuse: ({ account }) => {
      account.close({ detail: 'The org acme was deleted', because: 'org_deleted' });
      return Promise.resolve();
    },
  },
];

describe('a licensed runtime that refuses new runs', () => {
  it.each(refusals)(
    'as $kind still reads, edits and cancels: definitions, runs, their history, events and its license',
    async ({ kind, refuse }) => {
      const accounts = await accountsServed();
      const server = await servedBy(accounts, { AUTO_RUNTIME_LICENSE_KEY: accounts.key });
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'listening', source: listening } });
      const waiting = runIdIn(
        (await server.call('POST', `${alpha}/definitions/workflow/listening/run`, { body: { input: {} } })).body,
      );
      const ran = runIdIn((await tallied(server)).body);
      await refuse(accounts, server);

      const refused = await tallied(server);
      const reads = await Promise.all(
        [
          `${alpha}/definitions/workflow`,
          `${alpha}/definitions/workflow/tally`,
          `${alpha}/runs`,
          `${alpha}/runs/${ran}`,
          `${alpha}/runs/${ran}/history`,
          `${alpha}/events`,
          '/v1/orgs/acme/license',
        ].map(async (path) => (await server.call('GET', path)).status),
      );
      const created = await server.call('POST', `${alpha}/definitions/workflow`, {
        body: { name: 'later', source: later },
      });
      const retired = await server.call('POST', `${alpha}/definitions/workflow/later/retire`, { body: {} });
      const cancelled = await server.call('POST', `${alpha}/runs/${waiting}/cancel`, {
        body: { reason: 'No longer needed' },
      });
      const settled = await settledRun(server, `${alpha}/runs/${waiting}`);

      expect(refused.body).toMatchObject({ kind });
      expect(reads).toEqual([200, 200, 200, 200, 200, 200, 200]);
      expect([created.status, retired.status, cancelled.status]).toEqual([201, 200, 200]);
      expect(settled.body).toMatchObject({ status: 'rejected', rejection: { reason: 'cancelled' } });
    },
    60_000,
  );
});
