import { chatDelivery } from '@on.auto/interaction/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { chatEnvironment, chatServer, deliveryHistoryOf } from '../testing/interaction-servers/chat-deliveries.ts';
import { brief, servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

function asked(server: Awaited<ReturnType<typeof servingInteractions>>) {
  return server.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
    body: { input: brief, run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  });
}

async function refusedThrough(environment: Readonly<Record<string, string>>) {
  const server = await servingInteractions(chatDelivery, environment);
  const refusal = await asked(server);
  const history = await server.call('GET', `${alpha}/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/history`);
  return { refusal: refusal.body, types: decodeHistory(history.body).events.map(({ type }) => type) };
}

describe('a delivery through a tool this playbook may not use, over HTTP', () => {
  it('ends its run unavailable at the start, before anything is asked, in the words of the tool servers', async () => {
    const chat = await chatServer();

    const refusals = await Promise.all([
      refusedThrough({}),
      refusedThrough(chatEnvironment(chat.url, { org: 'globex' })),
      refusedThrough(chatEnvironment(chat.url, { allowed: ['echo'] })),
    ]);

    expect(refusals).toMatchObject([
      {
        refusal: { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_server_not_configured' },
        types: ['run_started', 'run_rejected'],
      },
      { refusal: { detail: 'No tool server named chat is configured for this playbook' } },
      {
        refusal: {
          because: 'tool_not_allowed',
          detail: 'The operator of this server does not allow chat/post_message',
        },
        types: ['run_started', 'run_rejected'],
      },
    ]);
    expect(chat.received()).toEqual([]);
  });

  it('fails an attempt as a tool no longer offered when the server no longer lists the tool, sending nothing, and tries again', async () => {
    const chat = await chatServer();
    chat.removeTool('post_message');
    const server = await servingInteractions(chatDelivery, chatEnvironment(chat.url));
    const runId = await server.ask('approve-brief');

    const facts = await until(
      () => deliveryHistoryOf(server, runId),
      (seen) => seen.length >= 2,
    );

    expect(facts.at(-1)).toMatchObject({
      type: 'delivery_failed',
      because: 'tool_not_offered',
      detail: 'The tool server chat does not list the tool post_message',
    });
    expect(chat.received()).toEqual([]);
    expect((await server.call('GET', `${alpha}/interactions`)).body).toMatchObject({
      interactions: [{ standing: 'retrying' }],
    });
  });
});
