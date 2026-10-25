import { setTimeout as sleep } from 'node:timers/promises';

import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';

import type { MeasuredLedger } from './measured-ledgers.ts';
import { playbook, inTurns, measuredServer, percentile, type MeasuredServer } from './measured-server.ts';
import { runIdOf, pauseSource, spread, timersMeasured, type TimerPlan } from './timer-runs.ts';

const chatKey = 'measure-chat-key-41c7a9e2';

const dueAfterRestartMs = 40_000;

const approval = [
  '---',
  "to: '{{ input.owner }}'",
  'expires: P1D',
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '#measure'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
  'replies:',
  "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ sent.conversation }}'",
  "    ts: '{{ sent.id }}'",
  `    oldest: '{{ since | default: "0" }}'`,
  '  read:',
  '    list: /messages',
  '    order: oldest_first',
  '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }',
  'output:',
  '  schema: { type: object, required: [choice], properties: { choice: { type: string, enum: [approve, reject] } } }',
  '---',
  'Approve the brief of {{ input.owner }}?',
].join('\n');

type Write = (line: string) => void;

interface ReadCount {
  readonly at: () => number | null;
  readonly stop: () => void;
}

function chatServerOf(url: string): Readonly<Record<string, string>> {
  return {
    CHAT_KEY: chatKey,
    TOOL_SERVERS: JSON.stringify({ chat: { url, headers: { Authorization: 'Bearer ${CHAT_KEY}' }, org: 'local' } }),
  };
}

function callsOf(chat: FakeMcpServer, tool: string): number {
  return chat.received().filter((call) => call.tool === tool).length;
}

async function deliveredTo(chat: FakeMcpServer, count: number): Promise<void> {
  if (callsOf(chat, 'post_message') < count) {
    await sleep(250);
    await deliveredTo(chat, count);
  }
}

function readsCounted(chat: FakeMcpServer, count: number): ReadCount {
  const reached: { at: number | null } = { at: null };
  const counting = setInterval(() => {
    reached.at ??= callsOf(chat, 'thread_replies') >= count ? Date.now() : null;
  }, 100);
  return {
    at: () => reached.at,
    stop: () => {
      clearInterval(counting);
    },
  };
}

async function askedOn(server: MeasuredServer, chat: FakeMcpServer, count: number): Promise<number> {
  await server.call('POST', '/v1/orgs/local/playbooks', { playbook: 'measure', name: 'Measure' });
  await server.call('POST', `${playbook}/definitions/interaction`, { name: 'approval', source: approval });
  await server.call('POST', `${playbook}/definitions/workflow`, { name: 'pause', source: pauseSource(30) });
  const from = Date.now();
  await inTurns(count, 32, async (index) => {
    runIdOf(
      await server.call('POST', `${playbook}/definitions/interaction/approval/run`, {
        input: { owner: `owner-${index}` },
      }),
    );
  });
  await deliveredTo(chat, count);
  return Date.now() - from;
}

export async function conversationsOn({ store, aLedger }: MeasuredLedger, count: number, write: Write): Promise<void> {
  const chat = await serveFakeMcp({ bearer: chatKey, chat: true });
  const ledger = await aLedger();
  const environment = { ...ledger.environment, ...chatServerOf(chat.url) };
  const first = await measuredServer(environment);
  const deliveredMs = await askedOn(first, chat, count);
  await first.stop();
  const dueAt = Date.now() + dueAfterRestartMs;
  const moved = await ledger.readEveryConversationAt(dueAt);
  const readBefore = callsOf(chat, 'thread_replies');
  const reads = readsCounted(chat, readBefore + moved);
  const second = await measuredServer(environment);
  try {
    const plan: TimerPlan = { firstDueAt: dueAt, count: 20, spacingMs: 3000, seconds: 30 };
    const { late, loads } = await timersMeasured(second, plan);
    const readAt = reads.at();
    const readMs = readAt === null ? Number.NaN : readAt - dueAt;
    const sorted = late.toSorted((a, b) => a - b);
    write(
      `${store}: ${count} requests asked and delivered, each into a thread of its own, in ${deliveredMs} ms; ${moved} conversations moved to be read at one moment after a restart; ${callsOf(chat, 'thread_replies') - readBefore} reads made, the ${moved}th ${readMs} ms after that moment, ${Math.round((moved * 1000) / readMs)} a second`,
    );
    write(
      `${store}: ${late.length} workflow timers due from that moment, one every ${plan.spacingMs} ms, late by ${spread(sorted)}; p50 ${percentile(sorted, 0.5)} ms`,
    );
    write(
      `${store}: one-minute, five-minute and fifteen-minute load averages every 10 s meanwhile: ${loads.join('; ')}`,
    );
  } finally {
    reads.stop();
    await second.stop();
    await chat.close();
  }
}
