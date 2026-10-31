import { agentDelivery } from '@on.auto/interaction/testing';
import { describe, expect, it } from 'vitest';

import { chatEnvironment, chatServer } from '../testing/interaction-servers/chat-deliveries.ts';
import { servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const limitApproval = [
  '---',
  "to: '{{ input.owner }}'",
  'expires: P2D',
  'deliver:',
  '  server: chat',
  '  tool: echo',
  '  with:',
  '    count: 3',
  '    unfurl: false',
  "    limit: '{{ input.limit }}'",
  "    text: 'Hello {{ to }}'",
  "    block: { type: section, text: '{{ message }}' }",
  "    schema: '{{ answer_schema }}'",
  'input:',
  '  schema:',
  '    type: object',
  '    required: [owner, limit]',
  '    properties:',
  '      owner: { type: string }',
  '      limit: { type: integer }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '---',
  'Approve the limit of {{ input.limit }}?',
].join('\n');

const answerSchema = {
  type: 'object',
  required: ['choice'],
  properties: { choice: { type: 'string', enum: ['approve', 'reject'] } },
};

describe('the arguments of a delivery, typed as written, over HTTP', () => {
  it('sends a number, a boolean and an object as written, an expression alone as its value, and other strings as text', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(agentDelivery, chatEnvironment(chat.url));
    await server.call('POST', `${alpha}/definitions/interaction`, {
      body: { name: 'approve-limit', source: limitApproval },
    });

    await server.call('POST', `${alpha}/definitions/interaction/approve-limit/run`, {
      body: { input: { owner: 'ada', limit: 20 } },
    });
    const [received] = await until(
      () => Promise.resolve(chat.received()),
      (calls) => calls.length > 0,
    );

    expect(received?.arguments).toEqual({
      count: 3,
      unfurl: false,
      limit: 20,
      text: 'Hello ada',
      block: { type: 'section', text: 'Approve the limit of 20?' },
      schema: answerSchema,
    });
  });
});
