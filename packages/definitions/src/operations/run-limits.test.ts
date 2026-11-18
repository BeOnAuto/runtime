import { AssetKeeper, Conflict, type ValueKeeping } from '@on.auto/operations';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { afterAToolThatMayAct } from '../runs/tool-refusals.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { toolUser } from '../testing/capabilities/tool-user.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { admittingMeter } from '../testing/recording-meter.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const anId: unknown = expect.any(String);

const utf8 = new TextEncoder();

interface Asked {
  readonly run: Parameters<ValueKeeping['kept']>[0];
  readonly value: Parameters<ValueKeeping['kept']>[1];
}

function keepingRecorded() {
  const asked: Asked[] = [];
  const keeper: ValueKeeping = {
    kept: (run, value) =>
      Effect.sync(() => {
        asked.push({ run, value });
        return {
          id: '019a8f2e-6b1c-7d4a-9e3f-2a1b0c9d8e7f',
          media_type: value.mediaType,
          bytes: utf8.encode(value.text).byteLength,
          sha256: 'e'.repeat(64),
          address: null,
          address_until: null,
        };
      }),
  };
  return { layer: Layer.merge(admittingMeter, Layer.succeed(AssetKeeper, keeper)), asked: () => asked };
}

async function withPlain(services?: Parameters<typeof harness>[0]) {
  const operations = definitionOperationsFor([probe().capability]);
  const definitions = harness(services);
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }),
  );
  const running = (input: unknown, id = runId) =>
    definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', input, run_id: id }));
  return { ...definitions, ...operations, running };
}

async function withToolUser(services: Parameters<typeof harness>[0]) {
  const operations = definitionOperationsFor([toolUser().capability]);
  const definitions = harness(services);
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', source: 'x' }),
  );
  const running = (input: unknown, id: string) =>
    definitions.call(
      operations.runDefinition,
      toAlpha(acmeAdmin, { type: 'tool-user', name: 'caller', input, run_id: id }),
    );
  return { running };
}

function inputTooLarge(bytes: number) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: 'What was given is too large',
    issues: [
      {
        detail: `The input takes ${String(bytes)} bytes as JSON, more than the 1 MiB a run takes; give a smaller input, or split the work across several runs`,
        pointer: '/input',
      },
    ],
  };
}

describe('the input of a run', () => {
  it('may take 1048576 bytes as JSON in UTF-8, as much as a run may answer, whatever its length in characters', async () => {
    const { running } = await withPlain();

    const envelope = JSON.stringify({ bulk: 1, pad: '' }).length;

    expect(await running({ bulk: 1, pad: 'a'.repeat(1_048_576 - envelope) })).toMatchObject({ status: 'succeeded' });
    expect(
      await running(
        { bulk: 1, pad: `${'é'.repeat((1_048_576 - envelope - 1) / 2)}a` },
        '0199a3c4-7d2e-7c1a-9b3f-000000000002',
      ),
    ).toMatchObject({
      status: 'succeeded',
    });
  });

  it('is rejected above that, before anything is recorded', async () => {
    const { running, ledger } = await withPlain();

    expect(await running('a'.repeat(1_048_575))).toEqual(inputTooLarge(1_048_577));
    expect(await running({ text: 'é'.repeat(524_286) })).toEqual(inputTooLarge(1_048_583));
    expect(ledger.streamNames()).toEqual([expect.stringMatching(/^definition\/acme\/[^/]+\/definitions\/probe$/u)]);
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
    expect(ledger.streamNames()).toEqual([expect.stringMatching(/^definition\/acme\/[^/]+\/definitions\/probe$/u)]);
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

  it('keep the largest members of the output above that, each as an asset of the playbook, and record the asset in their place', async () => {
    const keeping = keepingRecorded();
    const { running } = await withPlain(keeping.layer);
    const text = 'x'.repeat(1_048_573);

    expect(await running({ bulk: text.length })).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'succeeded',
        output: { id: '019a8f2e-6b1c-7d4a-9e3f-2a1b0c9d8e7f', bytes: text.length, address: null },
      },
    });
    expect(keeping.asked()).toEqual([
      {
        run: {
          context: {
            by: acmeAdmin.id,
            runId: runId,
            definitionType: 'probe',
            definitionName: 'plain',
            definitionVersion: 1,
          },
          lineage: { causationId: anId, correlationId: runId },
        },
        value: { pointer: '', text, mediaType: 'text/plain; charset=utf-8' },
      },
    ]);
  });

  it('reject the run above that as too large where the runtime keeps no asset, recording nothing of the output', async () => {
    const { running } = await withPlain();

    expect(await running({ bulk: 1_048_573 })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'oversized',
    });
  });
});

describe('a refusal to keep the output of a run', () => {
  it('says the tool ran and may have changed something once the run called a tool not marked reads, as its facts record', async () => {
    const refusal = new Conflict({ detail: 'The playbook keeps all the assets it may', kind: 'oversized' });
    const keeper: ValueKeeping = { kept: () => Effect.fail(refusal) };
    const { running } = await withToolUser(Layer.merge(admittingMeter, Layer.succeed(AssetKeeper, keeper)));
    const pastWhatARunRecords = 1_048_576;

    const answers = [
      await running({ calls: 1, bulk: pastWhatARunRecords }, runId),
      await running({ calls: 1, bulk: pastWhatARunRecords, reads: true }, '0199a3c4-7d2e-7c1a-9b3f-000000000002'),
      await running({ calls: 0, bulk: pastWhatARunRecords }, '0199a3c4-7d2e-7c1a-9b3f-000000000003'),
    ];

    expect(answers).toEqual(
      [afterAToolThatMayAct(refusal.detail), refusal.detail, refusal.detail].map((detail): unknown =>
        expect.objectContaining({ status: 'rejected', reason: 'conflict', kind: 'oversized', detail }),
      ),
    );
  });
});
