import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { probe, spentUsage } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const readingTheRun = toAlpha(acmeAdmin, { run_id: runId });

async function withPlain() {
  const prober = probe();
  const operations = definitionOperationsFor([prober.capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }),
  );
  const running = (input: object) =>
    definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'probe', name: 'plain', run_id: runId, ...input }),
    );
  return { ...definitions, ...operations, prober, running };
}

const failedRun = {
  run_id: runId,
  type: 'probe',
  name: 'plain',
  definition_version: 1,
  status: 'failed',
  started_at: firstMoment,
  started_by: { id: 'acme-admin', name: 'acme-admin' },
  finished_at: firstMoment,
};

describe('a run the capability cannot serve now', () => {
  it('is rejected with unavailable, and the rejection is recorded', async () => {
    const { call, running, getRun, prober } = await withPlain();
    prober.sufferOnNextRun('unavailable');

    expect(await running({})).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The probe cannot answer now',
    });
    expect(await call(getRun, readingTheRun)).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'unavailable', detail: 'The probe cannot answer now' } },
    });
  });
});

describe('a run that names a model the server is not set up for, while it can use others', () => {
  it('is rejected with unavailable of that kind and why, both recorded and answered again', async () => {
    const { call, running, getRun, prober } = await withPlain();
    prober.sufferOnNextRun('unoffered');

    expect(await running({})).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The probe cannot reach that model, only others',
      kind: 'model_not_offered',
      because: 'provider_not_configured',
    });
    expect(await call(getRun, readingTheRun)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: {
          reason: 'unavailable',
          detail: 'The probe cannot reach that model, only others',
          kind: 'model_not_offered',
          because: 'provider_not_configured',
        },
      },
    });
  });
});

describe('a run of a definition the capability cannot run as written', () => {
  it('is rejected with conflict, and the rejection is recorded and answered without a kind, as it was given', async () => {
    const { call, running, getRun, prober } = await withPlain();
    prober.sufferOnNextRun('conflict');

    expect(await running({})).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The probe cannot run this definition as written; update it',
    });
    expect(await call(getRun, readingTheRun)).toStrictEqual({
      status: 'succeeded',
      output: {
        ...failedRun,
        status: 'rejected',
        rejection: { reason: 'conflict', detail: 'The probe cannot run this definition as written; update it' },
      },
    });
  });
});

describe('a run whose capability finds, by running it, that its definition is unworkable', () => {
  it('is rejected with conflict of that kind, which is recorded and answered again', async () => {
    const { call, running, getRun, prober } = await withPlain();
    prober.sufferOnNextRun('unworkable');
    const rejection = {
      reason: 'conflict',
      detail: 'The program of the probe raised an error on line 2: stop',
      kind: 'unworkable',
    };

    expect(await running({})).toEqual({ status: 'rejected', ...rejection });
    expect(await call(getRun, readingTheRun)).toStrictEqual({
      status: 'succeeded',
      output: { ...failedRun, status: 'rejected', rejection },
    });
  });
});

describe('a run that could not finish after calling a tool that may change something', () => {
  it('is rejected with conflict of that kind and its because, which is recorded', async () => {
    const { call, running, getRun, prober } = await withPlain();
    prober.sufferOnNextRun('unknown');
    const rejection = {
      reason: 'conflict',
      detail: 'The probe could not finish after calling a tool that may post',
      kind: 'effect_unknown',
      because: 'tool_error',
    };

    expect(await running({})).toEqual({ status: 'rejected', ...rejection });
    expect(await call(getRun, readingTheRun)).toStrictEqual({
      status: 'succeeded',
      output: { ...failedRun, status: 'rejected', rejection },
    });
  });
});

describe('a run whose capability breaks down', () => {
  it('fails with an incident that holds the defect, and is recorded as failed', async () => {
    const { call, running, getRun, prober, reported } = await withPlain();
    prober.sufferOnNextRun('breakdown');

    expect(await running({})).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(reported().map(({ original }) => original)).toEqual([new Error('The probe broke down')]);
    expect(await call(getRun, readingTheRun)).toStrictEqual({
      status: 'succeeded',
      output: failedRun,
    });
  });

  it('fails the same way when the capability answers with output that is not JSON', async () => {
    const { call, running, getRun, reported } = await withPlain();

    expect(await running({ input: { unmeasurable: true } })).toEqual({
      status: 'failed',
      incident: reported()[0]?.id,
    });
    expect(Schema.isSchemaError(reported()[0]?.original)).toBe(true);
    expect(await call(getRun, readingTheRun)).toStrictEqual({
      status: 'succeeded',
      output: failedRun,
    });
  });
});

describe('a run the capability rejects after it spent something', () => {
  it('keeps what the rejection recorded on the run, as get_run shows it', async () => {
    const { call, running, getRun, prober } = await withPlain();
    prober.sufferOnNextRun('spent');

    expect(await running({})).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The probe was answered, but not usably',
    });
    expect(await call(getRun, readingTheRun)).toMatchObject({
      output: { status: 'rejected', record: { usage: spentUsage, duration_ms: 25 } },
    });
  });

  it('fails with an incident when what it recorded is more than a run may record', async () => {
    const { call, running, getRun, prober, reported } = await withPlain();
    prober.sufferOnNextRun('overspent');

    expect(await running({})).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(await call(getRun, readingTheRun)).toStrictEqual({
      status: 'succeeded',
      output: failedRun,
    });
  });
});

describe('run_definition rejecting', () => {
  it('a definition the playbook does not have, and a type the server does not run', async () => {
    const { call, runDefinition } = await withPlain();

    expect(await call(runDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'ghost' }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no probe definition ghost in this playbook',
    });
    expect(await call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'plain' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: 'Expected a type this server runs: probe' }],
    });
  });

  it('a definition whose document its capability no longer parses, recording nothing', async () => {
    const { running, ledger, prober } = await withPlain();
    prober.rejectEveryDocument();

    expect(await running({})).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The probe definition plain at version 1 no longer parses (The probe document has lines it does not accept); update it',
      kind: 'unworkable',
    });
    expect(ledger.streamNames()).toEqual(['playbook/acme/alpha/definitions/probe']);
  });

  it('a run id that is not a UUID', async () => {
    const { running } = await withPlain();

    expect(await running({ run_id: 'run-1' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/run_id', detail: 'Expected a UUID' }],
    });
  });
});
