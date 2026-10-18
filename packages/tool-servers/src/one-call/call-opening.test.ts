import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { secretsOf } from '../bounds/secrets.ts';
import type { ServerClient } from '../clients/server-client.ts';
import type { ServerLink } from '../clients/server-links.ts';
import type { StdioServerSettings } from '../settings/server-settings.ts';
import { openedFor } from './call-opening.ts';

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
  command: '/usr/local/bin/notes-mcp-server',
  args: [],
  env: new Map(),
};

const hanging: ServerLink = {
  settings,
  take: () => Promise.withResolvers<ServerClient>().promise,
  renew: () => Promise.withResolvers<ServerClient>().promise,
  release: () => Promise.resolve(),
  stop: () => Promise.resolve(),
};

const listing = {
  secrets: secretsOf([Redacted.make('notes-key')]),
  timing: { ...defaultTiming, openMs: 10 },
};

const exited: ServerClient = {
  call: () => Promise.reject(new Error('No call is made')),
  listTools: () => Promise.reject(new Error('No listing is made')),
  closed: Promise.resolve(),
  end: () => Promise.resolve(),
};

const notStartingAgain: ServerLink = {
  ...hanging,
  take: () => Promise.resolve(exited),
  renew: () => Promise.reject(new Error('The notes process could not start')),
};

describe('the opening of one call to a process that exited', () => {
  it('starts the process again before it lists its tools, and is unopened when it cannot', async () => {
    expect(await openedFor({ server: 'notes', tool: 'search' }, notStartingAgain, listing)).toEqual({
      kind: 'unopened',
      refused: 'tool_server_failed',
      because: 'failing',
      detail: 'The tool server notes could not be used: The notes process could not start',
    });
  });
});

describe('the opening of one call', () => {
  it('gives up on a client that does not open within the open bound, as a server that could not be reached', async () => {
    expect(await openedFor({ server: 'notes', tool: 'search' }, hanging, listing)).toEqual({
      kind: 'unopened',
      refused: 'tool_server_failed',
      because: 'unreachable',
      detail: 'The tool server notes could not be used: The tool server did not open a connection within 10 ms',
    });
  });
});
