import { memoryRecordedContent } from '@on.auto/content/testing';
import { PlaybookContext, Unavailable, playbookLedgerOf } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunAsRecorded } from '../runs/run.ts';
import { erasingReader, keptArmOf, keptIn } from '../testing/kept-payloads.ts';
import {
  payloadAsRead,
  payloadsKeptIn,
  payloadValueOf,
  valuesReadFor,
  withItsOutputRead,
  withItsOutputShown,
  type PayloadAsRead,
} from './run-payloads.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const report = { leads: ['lead-1', 'lead-2'], summary: 'x'.repeat(4096) };

const kept = keptArmOf(report);

function contentOf(failing = false) {
  const content = memoryRecordedContent();
  return failing ? { ...content, get: () => Effect.die(new Error('The bucket did not answer')) } : content;
}

const run: RunAsRecorded = {
  run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  type: 'computation',
  name: 'score-leads',
  definition_version: 1,
  status: 'succeeded',
  started_at: '2026-10-01T09:00:00.000Z',
  started_by: { id: 'acme-admin', name: 'acme-admin' },
};

describe('a payload of a run, read where its value is needed', () => {
  it('is its value inline with no read, and its value kept outside read from the content of its playbook', async () => {
    const content = contentOf();
    await Effect.runPromise(keptIn(content, alpha, report));
    const payloads = payloadsKeptIn(content, alpha);

    expect(
      await Effect.runPromise(
        Effect.all([payloadAsRead({ inline: 'small' }, payloads), payloadAsRead({ kept }, payloads)]),
      ),
    ).toEqual([{ read: 'small' }, { read: report }]);
    expect(await Effect.runPromise(payloadValueOf({ kept }, payloads))).toEqual(report);
    expect(await Effect.runPromise(payloadValueOf({ inline: 'small' }, payloads))).toBe('small');
  });

  it('is unread as unavailable where the store does not answer, missing where it holds nothing, and erased where it was erased', async () => {
    const reads = [
      payloadAsRead({ kept }, payloadsKeptIn(contentOf(true), alpha)),
      payloadAsRead({ kept }, payloadsKeptIn(contentOf(), alpha)),
      payloadAsRead({ kept }, erasingReader(alpha)),
    ];

    expect(await Effect.runPromise(Effect.all(reads))).toEqual([
      { unread: 'unavailable', kept },
      { unread: 'missing', kept },
      { unread: 'erased', kept },
    ]);
  });

  it('is erased however the erasing reader of a test is asked', async () => {
    const reader = erasingReader(alpha);

    expect(
      await Effect.runPromise(Effect.all([Effect.flip(reader.text(kept)), Effect.flip(reader.all([kept]))])),
    ).toMatchObject([{ _tag: 'payload_erased' }, { _tag: 'payload_erased' }]);
  });
});

function shown(read: PayloadAsRead) {
  return Effect.runPromiseExit(withItsOutputShown({ ...run, output: { kept } }, read));
}

describe('the output of a run, as an operation answers it', () => {
  it('is its value where it was read, and nothing for a run with no output', async () => {
    expect(await shown({ read: report })).toStrictEqual(Exit.succeed({ ...run, output: report }));
    expect(await Effect.runPromiseExit(withItsOutputShown(run))).toStrictEqual(Exit.succeed(run));
  });

  it('is its digest and size in its place where it is missing or erased, so the run is answered all the same', async () => {
    const inItsPlace = { ...run, output_sha256: kept.sha256, output_bytes: kept.bytes };

    expect([await shown({ unread: 'missing', kept }), await shown({ unread: 'erased', kept })]).toStrictEqual([
      Exit.succeed(inItsPlace),
      Exit.succeed(inItsPlace),
    ]);
  });

  it('is its value with no read where the operation that kept it has it in hand', async () => {
    const inHand = withItsOutputRead({ ...run, output: { kept } }, new Map([[kept.sha256, report]])).pipe(
      Effect.provideContext(playbookLedgerOf(memoryLedger().service, alpha)),
      Effect.provideService(PlaybookContext, alpha),
    );

    expect(await Effect.runPromise(inHand)).toEqual({ ...run, output: report });
  });

  it('is unavailable, to be asked again, where the store did not answer', async () => {
    expect(await shown({ unread: 'unavailable', kept })).toStrictEqual(
      Exit.fail(
        new Unavailable({
          detail:
            "The run's output, which its playbook keeps outside the run's record, could not be read just now; ask again in a moment",
        }),
      ),
    );
  });
});

describe('the values read to tell a payload kept outside from another', () => {
  it('are the values of those kept outside, by their digests', async () => {
    const content = contentOf();
    await Effect.runPromise(keptIn(content, alpha, report));

    expect(await Effect.runPromise(valuesReadFor([kept], payloadsKeptIn(content, alpha)))).toEqual(
      new Map([[kept.sha256, report]]),
    );
  });

  it('are refused where one is missing or erased, since nothing can tell it from another, and unavailable while the store does not answer', async () => {
    const refusals = [
      valuesReadFor([kept], payloadsKeptIn(contentOf(), alpha)),
      valuesReadFor([kept], erasingReader(alpha)),
      valuesReadFor([kept], payloadsKeptIn(contentOf(true), alpha)),
    ].map((read) => Effect.flip(read));
    const missing: unknown = expect.stringContaining('is missing from the content of its playbook');
    const erased: unknown = expect.stringContaining('was erased');

    expect(await Effect.runPromise(Effect.all(refusals))).toMatchObject([
      { _tag: 'conflict', detail: missing },
      { _tag: 'conflict', detail: erased },
      { _tag: 'unavailable' },
    ]);
  });
});
