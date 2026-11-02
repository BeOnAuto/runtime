import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { defaultTiming } from '../bounds/call-bounds.ts';
import { secretsOf } from '../bounds/secrets.ts';
import type { ListedTool } from '../bounds/tool-results.ts';
import type { ServerLink } from '../clients/server-links.ts';
import type { StdioServerSettings } from '../settings/server-settings.ts';
import { openedFor } from './call-opening.ts';
import { oneCall } from './one-call.ts';

const settings: StdioServerSettings = {
  type: 'stdio',
  name: 'notes',
  orgs: ['acme'],
  playbooks: null,
  allowed: null,
  marks: { reads: [], acts: [] },
  record_content: false,
  request_id: null,
  secrets: [],
  connection: null,
  provider: null,
  command: '/usr/local/bin/notes-mcp-server',
  args: [],
  env: new Map(),
};

const access = {
  secrets: secretsOf([Redacted.make('notes-key')]),
  timing: defaultTiming,
  keepIn: () => (text: string) => Promise.resolve(text),
};

const search = { server: 'notes', tool: 'search' };

function searchMarked(mark: ListedTool['mark']): ListedTool {
  return { name: 'search', inputSchema: { type: 'object' }, mark, marked_by: 'server' };
}

function listingSearchAs(...marks: readonly ListedTool['mark'][]): ServerLink {
  return {
    settings,
    take: () =>
      Promise.resolve({
        call: () => Promise.reject(new Error('No call is sent')),
        listTools: () => Promise.resolve(marks.map((mark) => searchMarked(mark))),
        closed: Promise.withResolvers<void>().promise,
        end: () => Promise.resolve(),
      }),
    renew: () => Promise.reject(new Error('No process is started again')),
    release: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
}

describe('the opening of one call to a tool its server lists twice', () => {
  it('is judged by the entry not marked reads, whichever comes first, and reads only when both are marked reads', async () => {
    expect([
      await openedFor(search, listingSearchAs('reads', 'acts'), access),
      await openedFor(search, listingSearchAs('unmarked', 'reads'), access),
      await openedFor(search, listingSearchAs('reads', 'reads'), access),
    ]).toMatchObject([
      { tool: { name: 'search', mark: 'acts' }, readOnly: false },
      { tool: { name: 'search', mark: 'unmarked' }, readOnly: false },
      { tool: { name: 'search', mark: 'reads' }, readOnly: true },
    ]);
  });
});

describe('a call that needs its tool marked reads, to a tool its server lists twice', () => {
  it('is refused before anything is sent when either entry is not marked reads', async () => {
    const server = {
      settings,
      checked: () => Promise.resolve([]),
      linked: () => Promise.resolve({ link: listingSearchAs('reads', 'acts') }),
    };
    const call = {
      org: 'acme',
      playbook: 'alpha',
      reference: search,
      input: {},
      meta: {},
      requiredMark: 'reads',
    } as const;

    expect(await Effect.runPromise(oneCall(call, server, access))).toEqual({
      kind: 'unopened',
      refused: 'tool_not_read_only',
      mark: 'acts',
      detail: 'The search tool of notes is marked acts, and the call needs one marked reads, so it was not sent',
    });
  });
});
