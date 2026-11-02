import { standingRenderClock } from '@on.auto/definitions/testing';
import type { ServerTool, ToolServer } from '@on.auto/tool-servers';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseLookupDocument } from '../document/document-parsing.ts';
import { lookupDocument, lookupRuns } from '../testing/index.ts';
import { markCheck } from './mark-check.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

function toolMarked(name: string, mark: ServerTool['mark']): ServerTool {
  return { name, description: `The ${name} tool.`, input_schema: { type: 'object' }, mark, marked_by: 'server' };
}

const tools = [toolMarked('thread', 'reads'), toolMarked('post_message', 'acts'), toolMarked('pin', 'unmarked')];

const selfHosted: ToolServer = {
  name: 'chat',
  type: 'mcp',
  record_content: true,
  playbooks: ['*'],
  provider: null,
  tools,
};

const fromTheCatalogue: ToolServer = { ...selfHosted, connection: 'conn_chat', provider: 'team-chat' };

const connectedByHand: ToolServer = { ...selfHosted, connection: 'conn_chat' };

function checkedAgainst(servers: readonly ToolServer[], tool = 'thread') {
  const document = Result.getOrThrow(parseLookupDocument(lookupDocument({ tool }), standingRenderClock));
  const check = markCheck({ listServers: () => Effect.succeed(servers) });
  return Effect.runSync(Effect.exit(check(document, '', alpha)));
}

function refusedWith(detail: string) {
  return Exit.fail(
    expect.objectContaining({
      _tag: 'invalid_input',
      detail: 'The lookup function definition has a problem',
      issues: [{ pointer: '', detail: `Line 4, /call: ${detail}` }],
    }),
  );
}

const toInteraction = "use an interaction function, or ask the server's author to mark it read-only";

function listedTwice(first: ServerTool['mark'], second: ServerTool['mark']): ToolServer {
  return { ...connectedByHand, tools: [toolMarked('thread', first), toolMarked('thread', second)] };
}

describe('the check of a lookup function when it is saved', () => {
  it('takes a tool its server marks reads, and keeps no stripped form', () => {
    expect(checkedAgainst([selfHosted])).toEqual(Exit.succeed({}));
  });

  it('refuses a tool marked acts, saying to use an interaction function, or to ask for it to be marked, by the kind of its server', () => {
    const marked = 'The post message tool of chat is marked acts, and a lookup function calls only a tool marked reads';

    expect([
      checkedAgainst([connectedByHand], 'post_message'),
      checkedAgainst([fromTheCatalogue], 'post_message'),
      checkedAgainst([selfHosted], 'post_message'),
    ]).toEqual([
      refusedWith(`${marked}: ${toInteraction}.`),
      refusedWith(
        `${marked}: ${toInteraction}; the providers catalogue may also mark it reads, in its entry for team-chat.`,
      ),
      refusedWith(
        `${marked}: ${toInteraction}; whoever runs this server may also mark it reads, in the marks of its entry in tool_servers.`,
      ),
    ]);
  });

  it('refuses a tool that carries no mark, which counts as acts', () => {
    expect(checkedAgainst([connectedByHand], 'pin')).toEqual(
      refusedWith(
        `The pin tool of chat carries no mark, which counts as acts, and a lookup function calls only a tool marked reads: ${toInteraction}.`,
      ),
    );
  });
});

describe('the check of a lookup function whose server lists its tool twice', () => {
  it('refuses it when either entry is not marked reads, whichever comes first, and takes it when both are', () => {
    const acting = `The thread tool of chat is marked acts, and a lookup function calls only a tool marked reads: ${toInteraction}.`;

    expect([
      checkedAgainst([listedTwice('reads', 'acts')]),
      checkedAgainst([listedTwice('acts', 'reads')]),
      checkedAgainst([listedTwice('reads', 'reads')]),
    ]).toEqual([refusedWith(acting), refusedWith(acting), Exit.succeed({})]);
  });
});

describe('the check of a lookup function that names what the playbook is not offered', () => {
  it('refuses a server that does not serve the playbook, and a tool its server does not offer it', () => {
    expect([
      checkedAgainst([]),
      checkedAgainst([selfHosted], 'gone'),
      checkedAgainst([connectedByHand], 'gone'),
    ]).toEqual([
      refusedWith(
        'No connection or tool server named chat serves this playbook; search lists those that do, and the mark of each of their tools.',
      ),
      refusedWith(
        'The tool server chat offers this playbook no tool named gone; search lists the tools it offers, and the mark of each.',
      ),
      refusedWith(
        'The connection chat offers this playbook no tool named gone; search lists the tools it offers, and the mark of each.',
      ),
    ]);
  });

  it('is unavailable, naming the server, when its server cannot be asked for its tools', () => {
    const unreachable: ToolServer = {
      name: 'chat',
      type: 'mcp',
      record_content: true,
      playbooks: ['*'],
      provider: null,
      unavailable: 'The tool server could not be reached',
      because: 'unreachable',
    };

    expect(checkedAgainst([unreachable])).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'unavailable',
          detail:
            'The tool server chat could not be asked for its tools just now. A lookup function is saved once its tool is seen to be marked reads, so save it again once chat can be asked.',
        }),
      ),
    );
  });
});

const savedAgainLater: unknown = expect.stringContaining('save it again once chat');

describe('the check of a lookup function against its server', () => {
  it('reads the mark the server lists its tool with, and is unavailable once the server is gone', async () => {
    const { fake, saved } = await lookupRuns({ server: { hints: { profile: { readOnlyHint: false } } } });
    const reading = await saved(lookupDocument());
    const acting = await saved(lookupDocument({ tool: 'profile', with: [] }));
    await fake.close();

    expect([reading, acting, await saved(lookupDocument())]).toEqual([
      Exit.succeed({}),
      Exit.fail(expect.objectContaining({ _tag: 'invalid_input' })),
      Exit.fail(expect.objectContaining({ _tag: 'unavailable', detail: savedAgainLater })),
    ]);
  });
});
