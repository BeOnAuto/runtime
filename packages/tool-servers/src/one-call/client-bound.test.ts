import { describe, expect, it } from 'vitest';

import type { ServerSlot } from '../calls/server-slot.ts';
import type { ServerClient } from '../clients/server-client.ts';
import type { ServerLink } from '../clients/server-links.ts';
import type { StdioServerSettings } from '../settings/server-settings.ts';
import { until } from '../testing/until.ts';
import { boundedSlot, takenWithin } from './client-bound.ts';

const client: ServerClient = {
  call: () => Promise.reject(new Error('No call is made')),
  listTools: () => Promise.resolve([]),
  closed: Promise.withResolvers<void>().promise,
  end: () => Promise.resolve(),
};

const anyMessage: unknown = expect.any(String);

const settings: StdioServerSettings = {
  type: 'stdio',
  name: 'notes',
  orgs: ['acme'],
  playbooks: null,
  allowed: null,
  record_content: false,
  request_id: null,
  secrets: [],
  connection: null,
  provider: null,
  command: '/usr/local/bin/notes-mcp-server',
  args: [],
  env: new Map(),
};

interface Opening extends ServerLink {
  readonly released: () => number;
}

function opening(take: () => Promise<ServerClient>): Opening {
  const counts = { released: 0 };
  return {
    settings,
    take,
    renew: take,
    release: () => {
      counts.released += 1;
      return Promise.resolve();
    },
    stop: () => Promise.resolve(),
    released: () => counts.released,
  };
}

describe('the opening of a client for one call', () => {
  it('takes a client that opens in time, and the failure of one that cannot open', async () => {
    const quick = opening(() => Promise.resolve(client));
    const failing = opening(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1')));

    expect(await takenWithin(quick, 1000)).toMatchObject({ slot: { settings } });
    expect(await takenWithin(failing, 1000)).toMatchObject({ failure: { message: anyMessage } });
    expect([quick.released(), failing.released()]).toEqual([0, 0]);
  });

  it('gives up at its bound, and lets go of a client that opens after it, never of one that fails', async () => {
    const slowOpening = Promise.withResolvers<ServerClient>();
    const failingOpening = Promise.withResolvers<ServerClient>();
    const slow = opening(() => slowOpening.promise);
    const slowFailing = opening(() => failingOpening.promise);

    const taken = await Promise.all([takenWithin(slow, 10), takenWithin(slowFailing, 10)]);
    failingOpening.reject(new Error('The server went away'));
    slowOpening.resolve(client);
    await until(() => slow.released() === 1);

    expect(taken).toEqual([{ late: true }, { late: true }]);
    expect(slowFailing.released()).toBe(0);
  });
});

describe('the session of one call, opened again or its process started again', () => {
  const hanging: ServerSlot = {
    settings,
    client: () => client,
    reopenOnce: () => Promise.withResolvers<boolean>().promise,
    restartIfExited: () => Promise.withResolvers<'restarted'>().promise,
    release: () => Promise.resolve(),
  };
  const quick: ServerSlot = {
    ...hanging,
    reopenOnce: () => Promise.resolve(true),
    restartIfExited: () => Promise.resolve('restarted'),
  };

  it('waits no longer than the open bound, and answers as the slot does when it is in time', async () => {
    const bounded = boundedSlot(hanging, 10);

    expect(await bounded.reopenOnce()).toBe(false);
    await expect(bounded.restartIfExited()).rejects.toThrow('The MCP server process did not start again within 10 ms');
    expect([await boundedSlot(quick, 1000).reopenOnce(), await boundedSlot(quick, 1000).restartIfExited()]).toEqual([
      true,
      'restarted',
    ]);
  });
});
