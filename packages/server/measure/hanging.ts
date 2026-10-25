import { deliveryIdKey } from '@on.auto/tool-servers/policy';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';

import type { MeasuredLedger } from './measured-ledgers.ts';
import { playbook, inTurns, measuredServer, percentile, type MeasuredServer } from './measured-server.ts';
import { runIdOf, pauseSource, spread, timersMeasured, type TimerPlan } from './timer-runs.ts';

const toolKey = 'measure-tool-key-6d02b8f1';

const approval = [
  '---',
  "to: '{{ input.owner }}'",
  'expires: P1D',
  'deliver:',
  '  server: hanging',
  '  tool: sleep',
  '  with:',
  '    ms: 3600000',
  "    text: '{{ message }}'",
  'output:',
  '  schema: { type: object, required: [choice], properties: { choice: { type: string } } }',
  '---',
  'Approve the brief of {{ input.owner }}?',
].join('\n');

type Write = (line: string) => void;

const decodeMeta = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

interface Bursts {
  readonly most: () => number;
  readonly stop: () => void;
}

function sampledBursts(tool: FakeMcpServer): Bursts {
  const seen: number[] = [];
  const counts = { most: 0 };
  const sampling = setInterval(() => {
    seen.push(tool.received().length);
    counts.most = Math.max(counts.most, (seen.at(-1) ?? 0) - (seen.at(-11) ?? 0));
  }, 100);
  return {
    most: () => counts.most,
    stop: () => {
      clearInterval(sampling);
    },
  };
}

function hangingServerOf(url: string): Readonly<Record<string, string>> {
  return {
    HANGING_KEY: toolKey,
    TOOL_SERVERS: JSON.stringify({
      hanging: { url, headers: { Authorization: 'Bearer ${HANGING_KEY}' }, org: 'local' },
    }),
  };
}

async function askedOn(server: MeasuredServer, requests: number, plan: TimerPlan): Promise<number> {
  await server.call('POST', '/v1/orgs/local/playbooks', { playbook: 'measure', name: 'Measure' });
  await server.call('POST', `${playbook}/definitions/interaction`, { name: 'approval', source: approval });
  await server.call('POST', `${playbook}/definitions/workflow`, { name: 'pause', source: pauseSource(plan.seconds) });
  const from = Date.now();
  await inTurns(requests, 32, async (index) => {
    runIdOf(
      await server.call('POST', `${playbook}/definitions/interaction/approval/run`, {
        input: { owner: `owner-${index}` },
      }),
    );
  });
  return Date.now() - from;
}

function attemptsOf(tool: FakeMcpServer) {
  const received = tool.received();
  const requests = new Set(received.map(({ meta }) => String(decodeMeta(meta)[deliveryIdKey])));
  return { attempts: received.length, requests: requests.size };
}

export async function hangingOn({ store, aLedger }: MeasuredLedger, requests: number, write: Write): Promise<void> {
  const tool = await serveFakeMcp({ bearer: toolKey });
  const ledger = await aLedger();
  const server = await measuredServer({ ...ledger.environment, ...hangingServerOf(tool.url) });
  const bursts = sampledBursts(tool);
  try {
    const plan: TimerPlan = { firstDueAt: Date.now() + 6000, count: 20, spacingMs: 3000, seconds: 5 };
    const askedAt = Date.now();
    const askedMs = await askedOn(server, requests, plan);
    const { late, loads } = await timersMeasured(server, plan);
    const watchedMs = Date.now() - askedAt;
    const sorted = late.toSorted((a, b) => a - b);
    const { attempts, requests: tried } = attemptsOf(tool);
    write(
      `${store}: ${requests} requests through a tool that never answers, asked in ${askedMs} ms; in the ${Math.round(watchedMs / 1000)} s from the first ask it took ${attempts} attempts of ${tried} requests, ${attempts - tried} of them a second attempt of a request whose first timed out, at most ${bursts.most()} of them sent within one second`,
    );
    write(
      `${store}: ${late.length} workflow timers due meanwhile, one every ${plan.spacingMs} ms, late by ${spread(sorted)}; in the order they were due, ${late.join(', ')} ms; p50 ${percentile(sorted, 0.5)} ms`,
    );
    write(
      `${store}: one-minute, five-minute and fifteen-minute load averages every 10 s meanwhile: ${loads.join('; ')}`,
    );
  } finally {
    bursts.stop();
    await server.stop();
    await tool.close();
  }
}
