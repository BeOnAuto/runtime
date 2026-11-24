import type { ToolServer } from '@on.auto/tool-servers';
import { Effect, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConversationTools } from '../tellings/telling-routes.ts';
import { redrawingConversations } from '../testing/chat-conversations.ts';
import { quietRowsDocument } from '../testing/clicked-cards.ts';
import {
  agentDelivery,
  approvalDocument,
  callDocument,
  fakeTools,
  interactionHarness,
  notificationDocument,
  type FakeTools,
} from '../testing/index.ts';
import { renderedDocument } from '../testing/rendered-documents.ts';

function serverNamed(name: string, renders?: string): ToolServer {
  return {
    name,
    type: 'mcp',
    record_content: true,
    playbooks: ['*'],
    provider: 'chat',
    ...(renders === undefined ? {} : { renders }),
    tools: [],
  };
}

function toolsListing(...servers: readonly ToolServer[]): FakeTools {
  return { ...fakeTools(), listServers: () => Effect.succeed(servers) };
}

const mustBeACard =
  'Line 5, /render: Messages sent through “chat” are shown as cards, so this one must be a card: write render: slack in the front matter and the card as the body, and read the guide render-slack first';

describe('a request sent through a connection that shows cards, when it is saved', () => {
  it('is refused when its message is text, with the words that say to write a card', async () => {
    const playbook = interactionHarness({ tools: toolsListing(serverNamed('chat', 'slack')) });

    expect(await playbook.define('tell-owner', notificationDocument())).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The interaction function definition has a problem',
      issues: [{ pointer: '/source', detail: mustBeACard }],
    });
  });

  it('is saved when its message is a card', async () => {
    const playbook = interactionHarness({ tools: toolsListing(serverNamed('chat', 'slack')) });

    expect(await playbook.define('tell-owner', renderedDocument())).toMatchObject({ status: 'succeeded' });
  });

  it('is saved when its connection shows no cards', async () => {
    const playbook = interactionHarness({ tools: toolsListing(serverNamed('chat')) });

    expect(await playbook.define('tell-owner', notificationDocument())).toMatchObject({ status: 'succeeded' });
  });

  it('is saved when its server is not one the playbook is served', async () => {
    const playbook = interactionHarness({ tools: toolsListing(serverNamed('mail', 'slack')) });

    expect(await playbook.define('tell-owner', notificationDocument())).toMatchObject({ status: 'succeeded' });
  });

  it('is saved when it is held for an agent', async () => {
    const playbook = interactionHarness({ tools: toolsListing(serverNamed('chat', 'slack')) });

    expect(await playbook.define('ask-owner', approvalDocument(agentDelivery))).toMatchObject({ status: 'succeeded' });
  });

  it('is not asked of a function that calls a tool', async () => {
    const playbook = interactionHarness({ tools: toolsListing(serverNamed('chat', 'slack')) });
    const source = callDocument({ tool: 'post_message', read: null, with: [], output: ['output:', '  schema: {}'] });

    expect(await playbook.define('posting', source)).toMatchObject({ status: 'succeeded' });
  });
});

const withoutSent = quietRowsDocument.replace('  sent:\n    conversation: /channel\n    id: /ts\n', '');

const updating = redrawingConversations;

const notUpdating: ConversationTools = Struct.omit(updating, ['update']);

const notClicking: ConversationTools = Struct.omit(updating, ['clicks']);

const savedThrough = (conversations: ConversationTools, source: string) =>
  interactionHarness({ tools: toolsListing(serverNamed('chat', 'slack')), conversations }).define('ask-owner', source);

function containing(words: string): unknown {
  return expect.stringContaining(words);
}

function refusedWith(...words: readonly string[]) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: 'The interaction function definition has a problem',
    issues: [{ pointer: '/source', detail: containing(words[0] ?? '') }],
  };
}

describe('a card with buttons, when it is saved', () => {
  it('is saved where its message can be found again, drawn again and clicked', async () => {
    expect(await savedThrough(updating, quietRowsDocument)).toMatchObject({ status: 'succeeded' });
  });

  it('is refused where deliver names no sent, with the words that say to write it', async () => {
    expect(await savedThrough(updating, withoutSent)).toEqual(
      refusedWith('A card with buttons finds its message again'),
    );
  });

  it('is refused where its connection says nothing of how a message is drawn again', async () => {
    expect(await savedThrough(notUpdating, quietRowsDocument)).toEqual(refusedWith('Nothing says how a message sent'));
  });

  it('is refused where its connection says nothing of a click reaching Auto', async () => {
    expect(await savedThrough(notClicking, quietRowsDocument)).toEqual(
      refusedWith('Nothing says that a click on a message sent'),
    );
  });

  it('is saved where its server is not one the playbook is served, as it is found out when it runs', async () => {
    const playbook = interactionHarness({ tools: toolsListing(serverNamed('mail', 'slack')) });

    expect(await playbook.define('ask-owner', quietRowsDocument)).toMatchObject({ status: 'succeeded' });
  });
});
