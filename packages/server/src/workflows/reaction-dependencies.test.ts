import { playbookOwnNamesOf, defineStartVersion } from '@on.auto/definitions';
import { echo } from '@on.auto/definitions/testing';
import type { PlaybookRequest, Dispatcher, Outcome } from '@on.auto/operations';
import { StartRefused, StartRejected } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { memoryRuntime } from '../testing/records/memory-runtime.ts';
import { reactionsOf } from './reaction-dependencies.ts';

const start = {
  org: 'acme',
  playbook: 'alpha',
  workflow: 'close-the-month',
  version: 2,
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  input: [{ type: 'com.acme.ledger.closed' }],
  depth: 3,
  cause: 'record-1',
  trigger: { kind: 'event', reference: '/schedule/on' },
} as const;

async function reactingWith(answers: readonly Outcome[]) {
  const runtime = await memoryRuntime();
  onTestFinished(() => runtime.dispose());
  const requests: PlaybookRequest[] = [];
  const dispatcher: Dispatcher = {
    dispatchToOrg: () => Effect.die(new Error('The reactions dispatch to no org')),
    dispatchToPlaybook: (_registration, request) =>
      Effect.sync(() => {
        requests.push(request);
        return answers[requests.length - 1] ?? { status: 'succeeded', output: {} };
      }),
  };
  const reacting = { startVersion: defineStartVersion([echo]), names: playbookOwnNamesOf([echo]) };
  return { reactions: reactionsOf(runtime, dispatcher, reacting), requests };
}

describe('a start of a workflow its trigger matched', () => {
  it('is asked of the playbook as the playbook itself, once under the id it was given, caused by what it matched, with its trigger', async () => {
    const { reactions, requests } = await reactingWith([]);

    await Effect.runPromise(reactions.start(start));

    expect(requests).toEqual([
      {
        caller: {
          id: 'playbook:alpha',
          org: 'acme',
          permissions: ['playbook:read', 'playbook:write'],
          playbooks: ['alpha'],
        },
        org: 'acme',
        playbook: 'alpha',
        input: {
          type: 'workflow',
          name: 'close-the-month',
          version: 2,
          input: start.input,
          run_id: start.runId,
        },
        encoding: 'json',
        lineage: { causationId: 'record-1', correlationId: start.runId },
        depth: 3,
        trigger: { kind: 'event', reference: '/schedule/on' },
      },
    ]);
  });

  it('is tried again when the playbook cannot take it now, and not when it never will', async () => {
    const { reactions } = await reactingWith([
      { status: 'rejected', reason: 'unavailable', detail: 'The ledger is busy' },
      { status: 'failed', incident: 'i-1' },
      { status: 'rejected', reason: 'invalid_input', detail: 'The input is not what the workflow takes' },
    ]);

    const failures = await Effect.runPromise(Effect.forEach([1, 2, 3], () => Effect.flip(reactions.start(start))));

    expect(failures).toStrictEqual([
      new StartRefused({ detail: 'The ledger is busy' }),
      new StartRefused({ detail: 'The start failed with incident i-1' }),
      new StartRejected({ detail: 'The input is not what the workflow takes' }),
    ]);
  });
});

describe('an event a workflow emits', () => {
  it('is recorded in the ledger of the server', async () => {
    const { reactions } = await reactingWith([]);
    const emission = {
      event: {
        specversion: '1.0',
        id: 'e1',
        source: '/ledger',
        type: 'com.acme.ledger.closed',
        time: '2026-10-01T09:00:00.000Z',
      },
      emitter: { run_id: start.runId, workflow: 'announce', version: 1 },
      depth: 1,
      by: 'playbook:alpha',
      at: '2026-10-01T09:00:00.000Z',
    };

    const outcome = await Effect.runPromise(
      reactions.emit({ org: 'acme', playbook: 'alpha' }, emission, {
        causationId: null,
        correlationId: start.runId,
      }),
    );

    expect(outcome).toBe('recorded');
  });
});
