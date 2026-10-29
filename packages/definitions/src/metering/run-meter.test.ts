import { Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { recordingMeter } from '../testing/recording-meter.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const parentId = '0199a3c4-7d2e-7c1a-9b3f-000000000001';

async function meteredBy(meter: Layer.Layer<never> | ReturnType<typeof recordingMeter> = recordingMeter()) {
  const prober = probe();
  const operations = definitionOperationsFor([prober.capability]);
  const recording = 'admitted' in meter ? meter : recordingMeter();
  const definitions = harness('admitted' in meter ? meter.layer : meter);
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }),
  );
  const running = (extra: object = {}) =>
    definitions.call(operations.runDefinition, {
      ...toAlpha(acmeAdmin, { type: 'probe', name: 'plain', run_id: runId }),
      ...extra,
    });
  return { ...definitions, meter: recording, prober, running };
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

describe('a run under a meter', () => {
  it('is admitted once, before it starts, with its definition, who started it and the top of its tree', async () => {
    const { meter, running } = await meteredBy();

    expect(await running()).toMatchObject({ status: 'succeeded' });
    expect(await running()).toMatchObject({ status: 'succeeded' });
    expect(meter.admitted()).toStrictEqual([admittedPlain]);
  });

  it('is admitted as the call of the run above it, at the top of that run’s tree', async () => {
    const { meter, running } = await meteredBy();
    const trigger = { kind: 'cron', reference: '/schedule/cron' } as const;

    await running({
      callDepth: 1,
      calledBy: { run_id: parentId, reference: '/do/0/ask', run: 1 },
      lineage: { causationId: parentId, correlationId: parentId },
      trigger,
    });

    expect(meter.admitted()).toStrictEqual([
      { ...admittedPlain, correlation_id: parentId, called_by: parentId, trigger },
    ]);
  });

  it('is admitted again when it is run again under its id after it failed', async () => {
    const { meter, prober, running } = await meteredBy();
    prober.sufferOnNextRun('breakdown');

    expect(await running()).toMatchObject({ status: 'failed' });
    expect(await running()).toMatchObject({ status: 'succeeded' });
    expect(meter.admitted().map(({ run_id: id }) => id)).toStrictEqual([runId, runId]);
  });
});

describe('a run the meter refuses', () => {
  it('is rejected with the meter’s refusal, and nothing of it is recorded or run', async () => {
    const { meter, prober, ledger, running } = await meteredBy();
    meter.refuseNext('license_required');
    meter.refuseNext('meter_unavailable');

    expect([await running(), await running()]).toStrictEqual([
      { status: 'rejected', reason: 'conflict', kind: 'license_required', detail: 'This runtime needs a license' },
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'meter_unavailable',
        detail: 'The account could not be asked',
      },
    ]);
    expect(prober.runs()).toBe(0);
    expect(ledger.streamNames()).not.toContain(`playbook/acme/alpha/runs/${runId}`);
  });

  it('is every run of a runtime composed without its meter', async () => {
    const { prober, running } = await meteredBy(Layer.empty);

    const refused = await running();

    expect(refused).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'This runtime is missing its usage meter and cannot start runs. Reinstall the official Auto Runtime package.',
    });
    expect(refused).not.toHaveProperty('kind');
    expect(prober.runs()).toBe(0);
  });
});

describe('a run that finishes after its call returns, under a meter', () => {
  it('is admitted once, as it starts', async () => {
    const meter = recordingMeter();
    const { running, settling } = await withHandOn(meter.layer);

    await running();
    await settling({ status: 'succeeded', output: { handed: true } });

    expect(meter.admitted().map(({ run_id: id }) => id)).toStrictEqual([relayedId]);
  });
});
