import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { comparedWithoutItsValue } from '../payloads/payload-comparisons.ts';
import { keptArmOf } from '../testing/kept-payloads.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';
import { endedWithAnotherResult } from './run-decisions.ts';
import { runSettler, runSettlerKeepingOutputs, type Settlement } from './run-settler.ts';

const relayed = { org: 'acme', playbook: 'alpha', id: relayedId };

const leads = Array.from({ length: 3000 }, (_, index) => `lead-${index}`);

const scored: Settlement = { status: 'succeeded', output: { leads, scores: { best: 1 } }, record: {} };

const reordered: Settlement = { status: 'succeeded', output: { scores: { best: 1 }, leads }, record: {} };

const another: Settlement = { status: 'succeeded', output: { leads: [], scores: { best: 1 } }, record: {} };

async function settledKeeping(keepsOutside: boolean) {
  const handed = await withHandOn();
  await handed.running();
  const settle = runSettlerKeepingOutputs(handed.ledger.service)(relayed, scored);
  await handed.run(Effect.orDie(settle.pipe(Effect.provideService(PayloadOffloading, keepsOutside))), settledAt);
  const { records } = await Effect.runPromise(
    handed.ledger.service.readRecorded(relayed, { kind: 'run', run: relayedId }, { order: 'asc', limit: 10 }),
  );
  const ended = records.find(({ type }) => type === 'run_succeeded');
  return { handed, ended: ended?.data, keptByDigest: JSON.stringify(ended?.data ?? null).includes('output_sha256') };
}

describe('a workflow’s run settled by the settler that keeps outputs', () => {
  it('keeps a large output outside the run’s ending where payloads are kept outside, and inline where they are not', async () => {
    const [keeping, inline] = [await settledKeeping(true), await settledKeeping(false)];

    expect(keeping.ended).toMatchObject({ output_bytes: JSON.stringify(scored.output).length, record: {} });
    expect(inline.ended).toEqual({ output: scored.output, record: {} });
  });
});

describe('a workflow’s run settled again after it ended with an output its playbook keeps outside', () => {
  it('records nothing for the same value in another order, read and compared, where a settler that reads nothing answers unavailable', async () => {
    const { handed } = await settledKeeping(true);
    const again = (settled: Effect.Effect<unknown, unknown>) => handed.run(Effect.result(settled), settledAt);

    const keeping = await again(runSettlerKeepingOutputs(handed.ledger.service)(relayed, reordered));
    const plain = await again(runSettler(handed.ledger.service)(relayed, reordered));

    expect(Result.isSuccess(keeping)).toBe(true);
    expect(plain).toEqual(Result.fail(comparedWithoutItsValue));
  });

  it('records nothing for the same text, with no read, and is a conflict for another value', async () => {
    const { handed } = await settledKeeping(true);
    const settle = runSettlerKeepingOutputs(handed.ledger.service);

    const same = await handed.run(Effect.result(settle(relayed, scored)), settledAt);
    const other = await handed.run(Effect.result(settle(relayed, another)), settledAt);

    expect(Result.isSuccess(same)).toBe(true);
    expect(other).toEqual(Result.fail(endedWithAnotherResult));
  });

  it('is unavailable while the kept output cannot be read', async () => {
    const { handed, keptByDigest } = await settledKeeping(true);
    const { service } = handed.ledger;
    const unreadable = { ...service, content: { ...service.content, get: () => Effect.die(new Error('down')) } };

    const settled = await handed.run(
      Effect.result(runSettlerKeepingOutputs(unreadable)(relayed, reordered)),
      settledAt,
    );

    expect(keptByDigest).toBe(true);
    expect(settled).toMatchObject(Result.fail({ _tag: 'unavailable' }));
  });
});

const prompt = { message: 'm'.repeat(17_000), truncated: false };

const promptKept = keptArmOf(prompt);

const answeredWithItsPrompt: Settlement = { status: 'succeeded', output: { score: 1 }, record: { model: 'x', prompt } };

async function endedKeeping(settlement: Settlement, keepsOutside: boolean) {
  const handed = await withHandOn();
  await handed.running();
  const settle = runSettlerKeepingOutputs(handed.ledger.service)(relayed, settlement);
  const settled = await handed.run(
    Effect.exit(settle.pipe(Effect.provideService(PayloadOffloading, keepsOutside))),
    settledAt,
  );
  const { records } = await Effect.runPromise(
    handed.ledger.service.readRecorded(relayed, { kind: 'run', run: relayedId }, { order: 'asc', limit: 10 }),
  );
  return { settled, ending: records.at(-1) };
}

describe('a run settled with a record that holds a large prompt, by the settler that keeps outputs', () => {
  it('keeps the prompt outside the run’s ending where payloads are kept outside, and in its record where they are not', async () => {
    const [keeping, inline] = [
      await endedKeeping(answeredWithItsPrompt, true),
      await endedKeeping(answeredWithItsPrompt, false),
    ];

    expect([keeping.ending?.data, inline.ending?.data]).toEqual([
      {
        output: { score: 1 },
        record: { model: 'x', prompt_sha256: promptKept.sha256, prompt_bytes: promptKept.bytes },
      },
      { output: { score: 1 }, record: { model: 'x', prompt } },
    ]);
  });

  it('counts the text of the prompt against what a run may record, wherever it would be kept, and breaks down past it', async () => {
    const tooLarge: Settlement = {
      status: 'succeeded',
      output: { score: 1 },
      record: { prompt: { message: 'm'.repeat(1_048_576), truncated: false } },
    };

    const { settled, ending } = await endedKeeping(tooLarge, true);

    expect(Exit.isFailure(settled)).toBe(true);
    expect(ending?.type).toBe('run_failed');
  });

  it('breaks down where the record names a prompt by a digest, which only the runtime keeps outside a run', async () => {
    const named: Settlement = {
      status: 'succeeded',
      output: { score: 1 },
      record: { prompt_sha256: promptKept.sha256, prompt_bytes: promptKept.bytes },
    };

    const { settled, ending } = await endedKeeping(named, true);

    expect(Exit.isFailure(settled)).toBe(true);
    expect(ending?.type).toBe('run_failed');
  });
});
