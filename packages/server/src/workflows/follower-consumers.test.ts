import type { Consumer, FollowedRecord } from '@on.auto/workflow-host';
import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';
import type { ConsumingParts } from './host-dependencies.ts';

interface Handed {
  readonly consumer: Consumer;
  readonly records: readonly FollowedRecord[];
  readonly asked: readonly string[];
}

function handed(name: string, wants: boolean): Handed {
  const records: FollowedRecord[] = [];
  const asked: string[] = [];
  return {
    consumer: {
      name,
      types: ['run_succeeded'],
      skippedAfterSweeps: 20,
      wants: (playbookKey) =>
        Effect.sync(() => {
          asked.push(playbookKey);
          return wants;
        }),
      batchOf: (followed) =>
        Effect.succeed({
          deliveries: [
            {
              key: followed.record.id,
              workflow: name,
              deliver: Effect.sync(() => {
                records.push(followed);
              }),
              skipped: Function.constant(Effect.void),
            },
          ],
          through: followed.record.id,
          more: false,
        }),
    },
    records,
    asked,
  };
}

describe('a consumer the composition gives the workflow host', () => {
  it('is handed the finished run of a playbook it wants, and one that does not want the playbook is handed nothing', async () => {
    const wanting = handed('wanting', true);
    const unwanting = handed('unwanting', false);
    const given: ConsumingParts[] = [];
    const server = await servingReasoning([], {}, undefined, {
      consumersOf: (parts) => {
        given.push(parts);
        return [wanting.consumer, unwanting.consumer];
      },
    });
    onTestFinished(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    const source = workflowSource('quick', 'do:\n  - done: { set: { quick: true } }\n');
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'quick', source } });

    const started = await server.call('POST', `${alpha}/definitions/workflow/quick/run`, { body: { input: {} } });
    const runId = runIdIn(started.body);
    await settledRun(server, `${alpha}/runs/${runId}`);
    const records = await until(
      () => wanting.records,
      (found) => found.length > 0,
    );

    expect(given).toHaveLength(1);
    expect(records.map(({ playbook, record, event }) => [playbook, record.stream, event.event.type])).toEqual([
      [{ org: 'acme', playbook: 'alpha' }, `runs/${runId}`, 'run_succeeded'],
    ]);
    expect([new Set(wanting.asked), new Set(unwanting.asked)]).toEqual([
      new Set(['playbook/acme/alpha/']),
      new Set(['playbook/acme/alpha/']),
    ]);
    expect(unwanting.records).toEqual([]);
  });
});
