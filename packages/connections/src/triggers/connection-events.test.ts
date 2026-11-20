import type { PlaybookAddress } from '@on.auto/operations';
import type { ToolServer } from '@on.auto/tool-servers';
import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { shipped } from '../testing/shipped-additions.ts';
import { connectionEventsOver } from './connection-events.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const reporter = shipped.providers.find(({ entry }) => entry.events?.types !== undefined);

const declared = reporter?.entry.events?.types ?? [];

const provider = reporter?.entry.name ?? null;

const listed = { type: 'mcp', record_content: false, playbooks: ['alpha'], tools: [] } as const;

const servers: readonly ToolServer[] = [
  { ...listed, name: 'reports', connection: 'c-1', provider },
  {
    ...listed,
    name: 'mended',
    connection: 'c-2',
    provider,
    unavailable: 'The connection is broken',
    because: 'connection_broken',
  },
  { ...listed, name: 'by-hand', connection: 'c-3', provider: null },
  { ...listed, name: 'in-the-file', provider },
];

function listing() {
  const asked: string[] = [];
  const listServers = (playbook: PlaybookAddress, named: string) =>
    Effect.sync(() => {
      asked.push(`${playbook.playbook}/${named}`);
      return servers.filter(({ name }) => name === named);
    });
  return { listServers, asked: () => [...asked] };
}

describe('what a connection reports, for the triggers of a playbook it serves', () => {
  it('is what its provider’s entry declares, whether it is broken, what the playbook’s workflows listen to through it, and that this runtime hears none of it yet', async () => {
    const { listServers, asked } = listing();
    const listened = [
      { workflow: 'on-items', connection: 'reports', type: 'opened' },
      { workflow: 'on-boards', connection: 'mended', type: 'closed', subject: 'board-1' },
    ];
    const events = connectionEventsOver(listServers, Effect.succeed(shipped), () => Effect.succeed(listened));

    const reportings = await Effect.runPromise(
      Effect.forEach(['reports', 'mended', 'by-hand', 'in-the-file', 'unknown'], (name) =>
        events.reportingOf(alpha, name),
      ),
    );

    expect(declared).not.toEqual([]);
    expect(reportings).toEqual([
      { broken: false, types: declared, heard: Function.constUndefined, listenedBy: [listened[0]] },
      { broken: true, types: declared, heard: Function.constUndefined, listenedBy: [listened[1]] },
      { broken: false, types: [], heard: Function.constUndefined, listenedBy: [] },
      undefined,
      undefined,
    ]);
    expect(asked()).toEqual(['alpha/reports', 'alpha/mended', 'alpha/by-hand', 'alpha/in-the-file', 'alpha/unknown']);
  });
});
