import { savedIn, standingRenderClock } from '@on.auto/definitions/testing';
import type { ServerTool, ToolServer } from '@on.auto/tool-servers';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parseInteractionDocument } from '../document/document-parsing.ts';
import type { CallDocument } from '../document/interaction-document.ts';
import { callDocument, fakeTools, interactionHarness } from '../testing/index.ts';
import { callCheck } from './call-check.ts';

const toALookup =
  'and a function that only reads what a system holds is a lookup function: save this one with type lookup, with the same call, input.schema and output.schema, and keep interaction functions for tools that act';

const anyOutput = ['output:', '  schema: {}'];

function calling(tool: string): string {
  return callDocument({ tool, read: null, with: [], output: anyOutput });
}

describe('an interaction function that calls a tool, when it is saved', () => {
  it('is refused, naming a lookup function, when its server marks the tool reads', async () => {
    const playbook = interactionHarness({ tools: fakeTools() });

    expect(await playbook.define('thread-replies', calling('thread_replies'))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The interaction function definition has a problem',
      issues: [
        { pointer: '/source', detail: `Line 4, /call: The thread replies tool of chat is marked reads, ${toALookup}` },
      ],
    });
  });

  it('is saved when its tool acts, carries no mark, or is not one its server lists', async () => {
    const playbook = interactionHarness({ tools: fakeTools() });

    expect([
      await playbook.define('posting', calling('post_message')),
      await playbook.define('threading', calling('thread')),
    ]).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
  });
});

const unreachable: ToolServer = {
  name: 'chat',
  type: 'mcp',
  record_content: true,
  playbooks: ['*'],
  provider: null,
  unavailable: 'The tool server could not be reached',
  because: 'unreachable',
};

function checkedAgainst(servers: readonly ToolServer[]) {
  const parsed = Result.getOrThrow(parseInteractionDocument(calling('thread_replies'), standingRenderClock));
  const document: CallDocument | undefined = parsed.shape === 'call' ? parsed : undefined;
  const check = callCheck({ listServers: () => Effect.succeed(servers) });
  return document === undefined ? undefined : Effect.runSync(Effect.exit(check(document, savedIn)));
}

function listingThreadRepliesAs(...marks: readonly ServerTool['mark'][]): ToolServer {
  return {
    name: 'chat',
    type: 'mcp',
    record_content: true,
    playbooks: ['*'],
    provider: null,
    tools: marks.map((mark) => ({
      name: 'thread_replies',
      description: 'Lists the messages of a thread.',
      input_schema: { type: 'object' },
      mark,
      marked_by: 'server',
    })),
  };
}

describe('the check of a call to a tool its server lists twice', () => {
  it('refuses it, naming a lookup function, only when both entries are marked reads', () => {
    expect([
      checkedAgainst([listingThreadRepliesAs('reads', 'reads')]),
      checkedAgainst([listingThreadRepliesAs('reads', 'acts')]),
      checkedAgainst([listingThreadRepliesAs('unmarked', 'reads')]),
    ]).toEqual([Exit.fail(expect.objectContaining({ _tag: 'invalid_input' })), Exit.succeed({}), Exit.succeed({})]);
  });
});

describe('the check of a call against servers that cannot say its mark', () => {
  it('saves a call whose server cannot be asked, or does not serve the playbook', () => {
    expect([checkedAgainst([unreachable]), checkedAgainst([])]).toEqual([Exit.succeed({}), Exit.succeed({})]);
  });
});
