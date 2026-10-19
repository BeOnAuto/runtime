import { approvalDocument, chatDelivery } from '@on.auto/interaction/testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  chatEnvironment,
  chatKey,
  chatServer,
  deliveryHistoryOf,
} from '../testing/interaction-servers/chat-deliveries.ts';
import {
  playbookEventsOf,
  flatReading,
  interactionsOf,
  readingIn,
  readRecorded,
  readsOf,
  readAndTold,
  someRead,
  threadReading,
  toldReading,
} from '../testing/interaction-servers/chat-readings.ts';
import { servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const threaded = [...chatDelivery, ...threadReading];

describe('a request whose function reads the replies to its message, over HTTP', () => {
  it('is answered by the reply of its party in the thread, read through the tool the function names', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(threaded, chatEnvironment(chat.url));
    const runId = await server.ask('approve-brief');
    const [listed] = await until(() => interactionsOf(server), readingIn(1));
    const [question] = chat.chat.posted();
    chat.chat.reply({ channel: '#approvals-ada', thread: question?.ts, user: 'ada', text: 'Approve, ready to ship' });

    const settled = await server.settled(runId);
    const events = await until(() => playbookEventsOf(server), readRecorded);

    expect(listed).toMatchObject({ conversation: '#approvals-ada/1699.000001', answerer: 'ada', reply_refusals: 0 });
    expect(settled).toMatchObject({ status: 'succeeded', output: { choice: 'approve' }, record: {} });
    expect(await server.call('GET', `${alpha}/runs/${runId}/history`)).toMatchObject({
      body: {
        events: [
          { type: 'run_started' },
          { type: 'interaction_requested' },
          { type: 'delivery_started' },
          { type: 'delivery_succeeded' },
          {
            type: 'request_answered',
            summary: 'A reply from the party answered the request, and the run takes the answer.',
            data: { answer: { choice: 'approve' }, reply: { id: '1699.000002', sender: 'ada' } },
            metadata: { by: 'playbook:alpha' },
          },
          { type: 'run_succeeded' },
        ],
      },
    });
    expect(await deliveryHistoryOf(server, runId)).toMatchObject([
      { type: 'delivery_started' },
      {
        type: 'delivery_succeeded',
        delivered_as: { conversation: '#approvals-ada', id: '1699.000001' },
        replies_in: { server: 'chat', tool: 'thread_replies', key: '#approvals-ada/1699.000001' },
      },
    ]);
    expect(events).toContain(
      'The playbook looked for new replies in the conversation “#approvals-ada/1699.000001” through the thread replies tool of chat and found 1, took 1 as an answer and refused 0.',
    );
  });
});

describe('a request whose function reads the replies to its message and changed since it asked, over HTTP', () => {
  it('is read as it was asked, though its function changed since', async () => {
    const chat = await chatServer();
    const server = await servingInteractions(threaded, chatEnvironment(chat.url));
    const runId = await server.ask('approve-brief');
    await until(() => interactionsOf(server), readingIn(1));
    const changed = approvalDocument([...chatDelivery, ...threadReading]).replace('tool: thread_replies', 'tool: echo');
    const updated = await server.call('PUT', `${alpha}/definitions/interaction/approve-brief`, {
      body: { source: changed },
    });
    chat.chat.reply({ channel: '#approvals-ada', thread: chat.chat.posted()[0]?.ts, user: 'ada', text: 'reject' });

    expect(updated.status).toBe(200);
    expect(await server.settled(runId)).toMatchObject({ status: 'succeeded', output: { choice: 'reject' } });
    expect(chat.received().map(({ tool }) => tool)).not.toContain('echo');
  });
});

describe('two functions that read one conversation with one tool, over HTTP', () => {
  it('share one row and one read for their requests', async () => {
    const chat = await chatServer();
    const server = await servingInteractions([...chatDelivery, ...flatReading], chatEnvironment(chat.url));
    await server.call('POST', `${alpha}/definitions/interaction`, {
      body: { name: 'approve-again', source: approvalDocument([...chatDelivery, ...flatReading]) },
    });
    await server.ask('approve-brief');
    await server.ask('approve-again');

    const listed = await until(() => interactionsOf(server), readingIn(2));
    const reads = await until(() => readsOf(chat), someRead);

    expect(listed.map(({ conversation }) => conversation)).toEqual(['#approvals-ada', '#approvals-ada']);
    expect(reads).toHaveLength(1);
  });
});

const secretSeen = (texts: readonly string[]) => texts.filter((text) => text.includes(chatKey));

describe('the secret of the tool server a function reads replies through, over HTTP', () => {
  it('reaches no read, telling, listing, history or line of the log, though the tool echoes it', async () => {
    const logged = vi.spyOn(console, 'error');
    onTestFinished(() => {
      logged.mockRestore();
    });
    const chat = await chatServer(chatKey);
    const server = await servingInteractions(
      [...chatDelivery, ...toldReading],
      chatEnvironment(chat.url, { record_content: true }),
    );
    const runId = await server.ask('approve-brief');
    await until(() => interactionsOf(server), readingIn(1));
    chat.chat.reply({ channel: '#approvals-ada', thread: chat.chat.posted()[0]?.ts, user: 'ada', text: 'maybe' });

    const events = await until(() => playbookEventsOf(server), readAndTold);
    const listing = JSON.stringify((await server.call('GET', `${alpha}/interactions`)).body);
    const history = JSON.stringify((await server.call('GET', `${alpha}/runs/${runId}/history`)).body);

    expect(events).toContain('[redacted]');
    expect(events).toContain('telling_started');
    expect(secretSeen([events, listing, history, ...logged.mock.calls.flat().map(String)])).toEqual([]);
  });
});
