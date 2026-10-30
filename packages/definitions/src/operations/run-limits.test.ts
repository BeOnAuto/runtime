import { describe, expect, it } from 'vitest';

import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function withPlain() {
  const operations = definitionOperationsFor([probe().capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }),
  );
  const running = (input: unknown, id = runId) =>
    definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', input, run_id: id }));
  return { ...definitions, ...operations, running };
}

const inputTooLarge = {
  status: 'rejected',
  reason: 'invalid_input',
  detail: 'The input does not match the input schema',
  issues: [{ detail: 'Expected an input of at most 262144 bytes as JSON in UTF-8', pointer: '/input' }],
};

describe('the input of a run', () => {
  it('may take 262144 bytes as JSON in UTF-8, whatever its length in characters', async () => {
    const { running } = await withPlain();

    expect(await running('a'.repeat(262_142))).toMatchObject({ status: 'succeeded' });
    expect(await running('é'.repeat(131_071), '0199a3c4-7d2e-7c1a-9b3f-000000000002')).toMatchObject({
      status: 'succeeded',
    });
  });

  it('is rejected above that, before anything is recorded', async () => {
    const { running, ledger } = await withPlain();

    expect(await running('a'.repeat(262_143))).toEqual(inputTooLarge);
    expect(await running({ text: 'é'.repeat(131_070) })).toEqual(inputTooLarge);
    expect(ledger.streamNames()).toEqual(['playbook/acme/alpha/definitions/probe']);
  });
});

function nested(levels: number, innermost: unknown = 1): unknown {
  return levels === 0 ? innermost : nested(levels - 1, levels % 2 === 0 ? [innermost] : { inner: innermost });
}

describe('the nesting of the input of a run', () => {
  it('may go 512 levels deep, as deep as a workflow holds a value', async () => {
    const { running } = await withPlain();

    expect(await running(nested(512))).toMatchObject({ status: 'succeeded' });
  });

  it('is rejected deeper than that, before anything is recorded, however deep it goes', async () => {
    const { running, ledger } = await withPlain();
    const tooDeep = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ detail: 'Expected an input that nests at most 512 levels deep', pointer: '/input' }],
    };

    expect(await running(nested(513))).toEqual(tooDeep);
    expect(await running(nested(3000))).toEqual(tooDeep);
    expect(ledger.streamNames()).toEqual(['playbook/acme/alpha/definitions/probe']);
  });
});

describe('the output and the record of a run', () => {
  it('may take 1048576 bytes together as JSON in UTF-8', async () => {
    const { running } = await withPlain();

    expect(await running({ bulk: 1_048_572 })).toMatchObject({
      status: 'succeeded',
      output: { status: 'succeeded' },
    });
  });

  it('fail the run above that, as a breakdown of the capability that is recorded', async () => {
    const { call, running, getRun, reported } = await withPlain();

    expect(await running({ bulk: 1_048_573 })).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(reported().map(({ original }) => original)).toEqual([
      new Error('The capability answered with 1048577 bytes to record, more than the 1048576 allowed'),
    ]);
    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runId }))).toMatchObject({
      output: { status: 'failed' },
    });
  });
});
