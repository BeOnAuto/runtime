import type { ToolServer } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

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
