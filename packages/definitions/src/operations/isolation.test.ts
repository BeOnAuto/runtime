import { describe, expect, it } from 'vitest';

import { acmeAdmin, acmeAlphaKeeper, acmeReader, globexAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const { createDefinition, runDefinition, getRun, getDefinition, listDefinitions, retireDefinition, updateDefinition } =
  definitionOperationsFor([echo]);

const toAlpha = toPlaybook('acme', 'alpha');

const toBeta = toPlaybook('acme', 'beta');

const toGamma = toPlaybook('globex', 'gamma');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const greet = { type: 'echo', name: 'greet' };

const hello = { ...greet, source: '{"greeting": "Hello"}' };

describe('the definitions and runs of a playbook', () => {
  it('are invisible from another playbook of the org and from a playbook of another org', async () => {
    const { call, ledger } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, hello));
    await call(runDefinition, toAlpha(acmeAdmin, { ...greet, run_id: runId }));

    expect(await call(getDefinition, toBeta(acmeAdmin, greet))).toMatchObject({ reason: 'not_found' });
    expect(await call(listDefinitions, toGamma(globexAdmin, { type: 'echo' }))).toEqual({
      status: 'succeeded',
      output: { definitions: [] },
    });
    expect(await call(getRun, toBeta(acmeAdmin, { run_id: runId }))).toMatchObject({
      reason: 'not_found',
    });
    expect(await call(getRun, toGamma(globexAdmin, { run_id: runId }))).toMatchObject({
      reason: 'not_found',
    });
    expect(ledger.streamNames()).toEqual(['playbook/acme/alpha/definitions/echo', `playbook/acme/alpha/runs/${runId}`]);
  });

  it('are apart from those of another playbook that uses the same names and run ids', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, hello));
    await call(createDefinition, toGamma(globexAdmin, { ...greet, source: '{"greeting": "Hola"}' }));
    await call(runDefinition, toAlpha(acmeAdmin, { ...greet, run_id: runId }));

    expect(await call(runDefinition, toGamma(globexAdmin, { ...greet, run_id: runId }))).toMatchObject({
      output: { output: { greeting: 'Hola' }, started_by: { id: 'globex-admin', name: 'globex-admin' } },
    });
  });

  it('cannot be reached by a caller of another org, whether they exist or not', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, hello));
    const foreign = { status: 'rejected', reason: 'forbidden', detail: 'The caller does not belong to this org' };

    expect(await call(getDefinition, toAlpha(globexAdmin, greet))).toEqual(foreign);
    expect(await call(runDefinition, toAlpha(globexAdmin, greet))).toEqual(foreign);
    expect(await call(getRun, toAlpha(globexAdmin, { run_id: runId }))).toEqual(foreign);
  });
});

describe('a caller that may only read', () => {
  it('reads definitions and runs, and is rejected for the commands, running included', async () => {
    const { call } = harness();
    await call(createDefinition, toAlpha(acmeAdmin, hello));
    await call(runDefinition, toAlpha(acmeAdmin, { ...greet, run_id: runId }));
    const readOnly = {
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller lacks the playbook:write permission',
    };

    expect(await call(createDefinition, toAlpha(acmeReader, { ...hello, name: 'wave' }))).toEqual(readOnly);
    expect(await call(updateDefinition, toAlpha(acmeReader, hello))).toEqual(readOnly);
    expect(await call(retireDefinition, toAlpha(acmeReader, greet))).toEqual(readOnly);
    expect(await call(runDefinition, toAlpha(acmeReader, greet))).toEqual(readOnly);
    expect(await call(getDefinition, toAlpha(acmeReader, greet))).toMatchObject({ status: 'succeeded' });
    expect(await call(listDefinitions, toAlpha(acmeReader, { type: 'echo' }))).toMatchObject({ status: 'succeeded' });
    expect(await call(getRun, toAlpha(acmeReader, { run_id: runId }))).toMatchObject({
      status: 'succeeded',
    });
  });
});

describe('a caller limited to some playbooks', () => {
  it('works with the definitions of its playbooks and is denied every other playbook', async () => {
    const { call } = harness();
    const denied = { status: 'rejected', reason: 'forbidden', detail: 'The caller may not access this playbook' };

    expect(await call(createDefinition, toAlpha(acmeAlphaKeeper, hello))).toMatchObject({
      output: { created_by: { id: 'acme-alpha-keeper', name: 'acme-alpha-keeper' } },
    });
    expect(await call(runDefinition, toAlpha(acmeAlphaKeeper, greet))).toMatchObject({ status: 'succeeded' });
    expect(await call(createDefinition, toBeta(acmeAlphaKeeper, hello))).toEqual(denied);
    expect(await call(listDefinitions, toBeta(acmeAlphaKeeper, { type: 'echo' }))).toEqual(denied);
  });
});
