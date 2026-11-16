import { createApiKey, type CreatedKey } from '@on.auto/identity';
import { movedClock, type MovedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import type { HostRuntime } from '../../workflows/host-dependencies.ts';
import { temporaryLedger, type TemporaryLedger } from '../records/temporary-ledger.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import { until } from '../waiting/until.ts';
import { leaseNamesIn, leftByAProcessThatDied, now, runId, type Left } from './left-by-dead-processes.ts';

export const writer = createApiKey({
  id: 'acme-writer',
  org: 'acme',
  permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
  playbooks: '*',
});

export const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: '*' });

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Say how the quarter went.'].join('\n');

export const quarter = { input: {}, run_id: runId };

const sweepingOften = { WORKFLOW_SWEEP_INTERVAL: 'PT0.01S' };

type Replies = Parameters<typeof servingReasoning>[0];

const keysOf = (...keys: readonly CreatedKey[]) => ({ API_KEYS: JSON.stringify(keys.map(({ entry }) => entry)) });

export const as = (key: Readonly<CreatedKey>) => ({ key: key.key });

export function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

async function aPlaybookOn(ledger: TemporaryLedger, withTheSummary: boolean): Promise<void> {
  const server = await servingReasoning([], keysOf(writer), undefined, { ledger });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' }, ...as(writer) });
  if (withTheSummary) {
    const body = { name: 'summary', source: summary, diagram: 'none' };
    await server.call('POST', `${alpha}/definitions/reasoning`, { body, ...as(writer) });
  }
  await server.stop();
}

interface Started {
  readonly server: ReasoningServer;
  readonly leaseNames: () => Promise<readonly string[]>;
}

export async function startedAfter(left: Left, keys: readonly CreatedKey[], replies: Replies = []): Promise<Started> {
  const ledger = aLedger();
  await aPlaybookOn(ledger, left.type === 'reasoning');
  const heard = Promise.withResolvers<HostRuntime>();
  const server = await servingReasoning(replies, { ...keysOf(...keys), ...sweepingOften }, undefined, {
    ledger,
    clock: movedClock(now),
    startingWork: leftByAProcessThatDied(left, heard.resolve),
  });
  onTestFinished(server.stop);
  return { server, leaseNames: () => leaseNamesIn(heard.promise) };
}

const StatusOf = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }));

export function endedOn(server: ReasoningServer, key?: Readonly<CreatedKey>) {
  return until(
    () => server.call('GET', `${alpha}/runs/${runId}`, key === undefined ? {} : as(key)),
    ({ body }) => StatusOf(body).status !== 'started',
  );
}

export async function aSummaryOn(
  ledger: TemporaryLedger,
  replies: Replies,
): Promise<{ server: ReasoningServer; clock: MovedClock }> {
  const clock = movedClock(now);
  const server = await servingReasoning(replies, sweepingOften, undefined, { ledger, clock });
  return { server, clock };
}

export async function aSummaryDefinedOn(server: ReasoningServer): Promise<void> {
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summary, diagram: 'none' },
  });
}
