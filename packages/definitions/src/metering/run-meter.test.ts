import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../index.ts';
import { modelCallAnswered, modelCallSent } from '../journal-testing/model-calls.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { recordingMeter } from '../testing/recording-meter.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const parentId = '0199a3c4-7d2e-7c1a-9b3f-000000000001';

interface Spender {
  readonly capability: Capability;
  readonly runs: () => number;
}

const brokenDown = new Error('The spender broke down after its first model call');

function spender(): Spender {
  let runs = 0;
  const capability = defineCapability({
    type: 'spending',
    title: 'Spending',
    guide: { name: 'spending' },
    noun: { one: 'spend', other: 'spends' },
    describeOutput: () => 'It spent.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    run: (_source, _input, { journal }) =>
      Effect.gen(function* () {
        runs += 1;
        const first = journal.attempt.modelCallsBefore + 1;
        yield* journal.record({ type: 'model_call_started', data: { number: first, ...modelCallSent() } });
        yield* journal.record({ type: 'model_call_answered', data: { number: first, ...modelCallAnswered(0) } });
        if (runs === 1) {
          return yield* Effect.die(brokenDown);
        }
        const { cost_usd: _cost, ...uncosted } = modelCallAnswered(0);
        yield* journal.record({ type: 'model_call_started', data: { number: first + 1, ...modelCallSent() } });
        yield* journal.record({ type: 'model_call_answered', data: { number: first + 1, ...uncosted } });
        return { output: { spent: true }, record: {} };
      }),
  });
  return { capability, runs: () => runs };
}

async function metered() {
  const meter = recordingMeter();
  const prober = probe();
  const spending = spender();
  const operations = definitionOperationsFor([prober.capability, spending.capability]);
  const definitions = harness(meter.layer);
  const created = (type: string, name: string) =>
    definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type, name, source: 'text' }));
  await created('probe', 'plain');
  await created('spending', 'calls');
  const running = (type: string, name: string, extra: object = {}) =>
    definitions.call(operations.runDefinition, { ...toAlpha(acmeAdmin, { type, name, run_id: runId }), ...extra });
  return { ...definitions, meter, prober, spending, running };
}

const admittedPlain = {
  org: 'acme',
  playbook: 'alpha',
  run_id: runId,
  definition_type: 'probe',
  definition_name: 'plain',
  definition_version: 1,
  correlation_id: runId,
  called_by: null,
  trigger: null,
  started_by: 'acme-admin',
};

const ofTheRun = { org: 'acme', playbook: 'alpha', run_id: runId };

describe('a run under a meter', () => {
  it('is admitted once, before it starts, with its definition, who started it and the top of its tree', async () => {
    const { meter, running } = await metered();

    expect(await running('probe', 'plain')).toMatchObject({ status: 'succeeded' });
    expect(await running('probe', 'plain')).toMatchObject({ status: 'succeeded' });
    expect(meter.admitted()).toStrictEqual([admittedPlain]);
  });

  it('is admitted as the call of the run above it, at the top of that run’s tree', async () => {
    const { meter, running } = await metered();
    const trigger = { kind: 'cron', reference: '/schedule/cron' } as const;

    await running('probe', 'plain', {
      callDepth: 1,
      calledBy: { run_id: parentId, reference: '/do/0/ask', run: 1 },
      lineage: { causationId: parentId, correlationId: parentId },
      trigger,
    });

    expect(meter.admitted()).toStrictEqual([
      { ...admittedPlain, correlation_id: parentId, called_by: parentId, trigger },
    ]);
  });

  it('is rejected with the meter’s refusal, and nothing of it is recorded or run', async () => {
    const { meter, prober, ledger, running } = await metered();
    meter.refuseNext('credits_exhausted');
    meter.refuseNext('meter_unavailable');

    expect([await running('probe', 'plain'), await running('probe', 'plain')]).toStrictEqual([
      { status: 'rejected', reason: 'conflict', kind: 'credits_exhausted', detail: 'The account has no credits left' },
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'meter_unavailable',
        detail: 'The account could not be asked',
      },
    ]);
    expect(prober.runs()).toBe(0);
    expect(meter.settled()).toStrictEqual([]);
    expect(ledger.streamNames()).not.toContain(`playbook/acme/alpha/runs/${runId}`);
  });
});

describe('the settlement of a run under a meter', () => {
  it('is made as the run ends, with how it ended', async () => {
    const { meter, prober, running } = await metered();
    prober.sufferOnNextRun('conflict');

    expect(await running('probe', 'plain')).toMatchObject({ status: 'rejected' });
    expect(meter.settled()).toStrictEqual([
      { ...ofTheRun, status: 'rejected', rejection: 'conflict', model_calls: [] },
    ]);
  });

  it('holds every model call that answered a cost, by its number, across the attempts under the run’s id', async () => {
    const { meter, spending, running } = await metered();

    expect(await running('spending', 'calls')).toMatchObject({ status: 'failed' });
    expect(await running('spending', 'calls')).toMatchObject({ status: 'succeeded' });
    expect(spending.runs()).toBe(2);
    expect(meter.admitted().map(({ run_id: id }) => id)).toStrictEqual([runId, runId]);
    expect(meter.settled()).toStrictEqual([
      { ...ofTheRun, status: 'failed', model_calls: [{ number: 1, cost_usd: 0.000_42 }] },
      {
        ...ofTheRun,
        status: 'succeeded',
        model_calls: [
          { number: 1, cost_usd: 0.000_42 },
          { number: 2, cost_usd: 0.000_42 },
        ],
      },
    ]);
  });

  it('of a run that finishes after its call returns is made once it is settled, not as its call returns', async () => {
    const meter = recordingMeter();
    const { running, settling } = await withHandOn(meter.layer);

    await running();
    expect(meter.settled()).toStrictEqual([]);

    await settling({ status: 'succeeded', output: { handed: true } });
    expect(meter.admitted().map(({ run_id: id }) => id)).toStrictEqual([relayedId]);
    expect(meter.settled()).toStrictEqual([
      { org: 'acme', playbook: 'alpha', run_id: relayedId, status: 'succeeded', model_calls: [] },
    ]);
  });
});
