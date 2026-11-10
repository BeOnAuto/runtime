import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runDecider } from '../runs/run-decider.ts';
import { asked, askedRun } from '../testing/asked-runs.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function storedTextOf({ ledger }: Pick<Harness, 'ledger'>, run: string): Promise<string | undefined> {
  const { records } = await Effect.runPromise(
    ledger.service.readRecorded(alpha, { kind: 'run', run }, { order: 'desc', limit: 1 }),
  );
  return records.map(({ data }) => JSON.stringify(data)).at(0);
}

describe('the text a run fact is stored as while the switch is off, as the release before stores it', () => {
  it('is that of a start with every optional member', async () => {
    const definitions = harness();
    const start = { type: 'start', definition_type: 'echo', name: 'greet', input: { lead: 'lead-1' } } as const;
    const options = { calls_tools: true, finishes_later: true, resumes: true, output_shape: 'table' } as const;
    const command = { ...start, ...options, started_by: recordedAdmin, definition_version: 1 };
    await Effect.runPromise(
      definitions.ledger.service.execute(`playbook/acme/alpha/runs/${runId}`, runDecider, {
        ...command,
        runId,
        by: 'acme-admin',
        at: '2026-10-01T09:00:00.000Z',
      }),
    );

    expect(await storedTextOf(definitions, runId)).toBe(
      '{"input":{"lead":"lead-1"},"started_by":{"id":"acme-admin","name":"acme-admin"},"calls_tools":true,"finishes_later":true,"resumes":true,"output_shape":"table"}',
    );
  });

  it('is that of a success an attempt records', async () => {
    const definitions = harness();
    const { createDefinition, runDefinition } = definitionOperationsFor([echo]);
    const toAlpha = toPlaybook('acme', 'alpha');
    await definitions.call(
      createDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
    );
    await definitions.call(
      runDefinition,
      toAlpha(acmeAdmin, { type: 'echo', name: 'greet', input: { who: 'Ada' }, run_id: runId }),
    );

    expect(await storedTextOf(definitions, runId)).toBe(
      '{"output":{"greeting":"Hi","input":{"who":"Ada"}},"record":{"greeting":"Hi"}}',
    );
  });
});

describe('the text a settlement or an answer is stored as while the switch is off, as the release before stores it', () => {
  it('is that of a success a settlement records', async () => {
    const relayed = await withHandOn();
    await relayed.running();
    await relayed.settling({ status: 'succeeded', output: 'handed on', record: { steps: 3 } });

    expect(await storedTextOf(relayed, relayedId)).toBe('{"output":"handed on","record":{"steps":3}}');
  });

  it('is that of an answer with whom it was claimed for and the reply that brought it', async () => {
    const { record, ledger } = await asked();
    const answer = { answer: { choice: 'approve' }, claimed_for: 'ada', reply: { id: 'reply-1', sender: 'U1' } };
    await Effect.runPromise(record(askedRun, { type: 'answer', answer }, { causationId: null, correlationId: runId }));

    expect(await storedTextOf({ ledger }, askedRun.id)).toBe(
      '{"answer":{"choice":"approve"},"claimed_for":"ada","reply":{"id":"reply-1","sender":"U1"},"answered_by":{"id":"playbook:alpha","name":"alpha"}}',
    );
  });
});
