import {
  keptArmOf,
  keptIn,
  keptLongBeforeAndLost,
  recordedAsGiven,
  runContentHolders,
  watchedStore,
} from '@on.auto/definitions/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from '../requests/open-requests.ts';
import { askedRunId, askedThroughChat } from '../testing/index.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const keptRunId = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const input = { campaign: 'Spring', owner: 'ada', brief: 'b'.repeat(4096) };

const RecordedSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: Schema.JsonObject });

const decodeRecorded = Schema.decodeUnknownSync(Schema.Array(RecordedSchema));

async function typesOn(ledger: ReturnType<typeof memoryLedger>, run: string) {
  const { records } = await Effect.runPromise(
    ledger.service.readRecorded(alpha, { kind: 'run', run }, { order: 'asc', limit: 20 }),
  );
  return decodeRecorded(records);
}

async function askedWithAKeptInput(held: boolean) {
  const watched = watchedStore();
  const ledger = memoryLedger(undefined, [openRequests], runContentHolders, watched.store);
  const asked = await askedThroughChat({ ledger });
  const [, deferral] = await typesOn(ledger, askedRunId);
  const { sha256, bytes } = keptArmOf(input);
  const context = {
    runId: keptRunId,
    by: 'acme-admin',
    at: new Date(asked.askedAt).toISOString(),
    definitionType: 'interaction',
    definitionName: 'approve-brief',
    definitionVersion: 1,
  };
  await Effect.runPromise(
    Effect.all([
      held
        ? keptIn(ledger.service.content, alpha, input)
        : keptLongBeforeAndLost(ledger.service.content, watched.store, alpha, input),
      recordedAsGiven(
        ledger.service,
        `playbook/acme/alpha/runs/${keptRunId}`,
        [
          {
            type: 'run_started',
            data: {
              input_sha256: sha256,
              input_bytes: bytes,
              started_by: { id: 'acme-admin', name: 'acme-admin' },
              finishes_later: true,
            },
          },
          {
            type: 'run_deferred',
            data: { record: Schema.decodeUnknownSync(Schema.JsonObject)(deferral?.data['record']) },
          },
        ],
        context,
      ),
    ]),
  );
  return { ...asked, ledger, watched };
}

describe('the delivery of a request whose input its playbook keeps outside its run', () => {
  it('reads the input and delivers the request as any', async () => {
    const asked = await askedWithAKeptInput(true);

    await asked.playbook.performDue(asked.askedAt);

    expect((await typesOn(asked.ledger, keptRunId)).map(({ type }) => type)).toEqual([
      'run_started',
      'run_deferred',
      'delivery_started',
      'delivery_succeeded',
    ]);
    expect(asked.watched.reads()).toBe(1);
  });

  it('records nothing while the store of its content does not answer, so the attempt stays due', async () => {
    const asked = await askedWithAKeptInput(true);
    asked.watched.fail();

    await asked.playbook.performDue(asked.askedAt);

    expect((await typesOn(asked.ledger, keptRunId)).map(({ type }) => type)).toEqual(['run_started', 'run_deferred']);
    expect((await typesOn(asked.ledger, askedRunId)).map(({ type }) => type)).toContain('delivery_succeeded');
  });

  it('records the attempt refused, as one that cannot be written, where its input is missing', async () => {
    const asked = await askedWithAKeptInput(false);

    await asked.playbook.performDue(asked.askedAt);

    expect((await typesOn(asked.ledger, keptRunId)).slice(2)).toMatchObject([
      { type: 'delivery_started' },
      {
        type: 'delivery_refused',
        data: {
          because: 'unworkable',
          detail:
            "The request's input, which its playbook kept outside its run, is missing from the playbook's content, so its message cannot be written",
        },
      },
    ]);
  });
});
