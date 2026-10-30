import { describe, expect, it } from 'vitest';

import { calledOnce, closedAfter, oneCallAccess, oneCallKey } from '../testing/one-calls.ts';
import { serveFakeMcp } from './fake-mcp-server.ts';

async function chatServer() {
  const fake = await serveFakeMcp({ bearer: oneCallKey, chat: true });
  closedAfter(fake.close);
  return fake;
}

const posting = { reference: { server: 'graph', tool: 'post_message' } };

describe('the chat of the fake MCP server', () => {
  it('posts a message, in a thread when asked, and answers where it landed', async () => {
    const fake = await chatServer();
    const access = oneCallAccess(fake.url, { allowed: ['post_message'] });

    const posted = await calledOnce(access, { ...posting, input: { channel: '#approvals', text: 'Approve?' } });
    await calledOnce(access, {
      ...posting,
      input: { channel: '#approvals', text: 'Thanks', thread_ts: '1699.000001' },
    });

    expect(posted).toMatchObject({
      outcome: 'result',
      answer: {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, channel: '#approvals', ts: '1699.000001' }) }],
      },
    });
    expect(fake.chat.posted()).toEqual([
      { ts: '1699.000001', channel: '#approvals', user: 'playbook', text: 'Approve?' },
      { ts: '1699.000002', channel: '#approvals', user: 'playbook', text: 'Thanks', thread_ts: '1699.000001' },
    ]);
  });
});

describe('the replies in the chat of the fake MCP server', () => {
  it('are listed for a thread after a point, or for the whole conversation, oldest first', async () => {
    const fake = await chatServer();
    const access = oneCallAccess(fake.url, { allowed: ['post_message', 'thread_replies'] });
    await calledOnce(access, { ...posting, input: { channel: '#approvals', text: 'Approve?' } });
    fake.chat.reply({ channel: '#approvals', thread: '1699.000001', user: 'ada', text: 'approve' });
    fake.chat.reply({ channel: '#approvals', user: 'ada', text: 'Thanks' });
    const reading = { reference: { server: 'graph', tool: 'thread_replies' } };

    const [thread, after, whole] = await Promise.all([
      calledOnce(access, { ...reading, input: { channel: '#approvals', ts: '1699.000001' } }),
      calledOnce(access, { ...reading, input: { channel: '#approvals', ts: '1699.000001', oldest: '1699.000001' } }),
      calledOnce(access, { ...reading, input: { channel: '#approvals' } }),
    ]);

    expect([thread, after, whole].map((called) => JSON.stringify(called))).toEqual([
      expect.stringContaining('1699.000002'),
      expect.not.stringContaining('Approve?'),
      expect.stringContaining('Thanks'),
    ]);
    expect(JSON.stringify(thread)).not.toContain('Thanks');
  });
});

describe('the chat of a fake MCP server that echoes a value', () => {
  it('carries it in every answer of its chat tools, as a server that echoes its key would', async () => {
    const fake = await serveFakeMcp({ bearer: oneCallKey, chat: true, echoes: 'echoed-value-5c1d' });
    closedAfter(fake.close);
    const access = oneCallAccess(fake.url, { allowed: ['post_message', 'thread_replies'] });

    const answers = await Promise.all([
      calledOnce(access, { ...posting, input: { channel: '#approvals', text: 'Approve?' } }),
      calledOnce(access, { reference: { server: 'graph', tool: 'thread_replies' }, input: { channel: '#approvals' } }),
    ]);

    expect(answers.map((answer) => JSON.stringify(answer).includes('echoed-value-5c1d'))).toEqual([true, true]);
  });
});

describe('the chat tools of the fake MCP server', () => {
  it('is offered only by a server asked to hold one', async () => {
    const plain = await serveFakeMcp({ bearer: oneCallKey });
    closedAfter(plain.close);

    expect(
      await calledOnce(oneCallAccess(plain.url, { allowed: ['post_message'] }), {
        ...posting,
        input: { channel: '#approvals', text: 7 },
      }),
    ).toMatchObject({ kind: 'unopened', because: 'tool_not_listed' });
  });
});
