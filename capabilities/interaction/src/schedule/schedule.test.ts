import { defineGetRunHistory, makeDefinitionPresenters } from '@on.auto/definitions';
import {
  keptArmOf,
  keptIn,
  keptLongBeforeAndLost,
  recordedAsGiven,
  runContentHolders,
  watchedStore,
} from '@on.auto/definitions/testing';
import { Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { openRequests } from '../requests/open-requests.ts';
import {
  askedRunId,
  askedThroughChat,
  fakeTools,
  interactionHarness,
  ledgerKeepingNames,
  nudging,
  recordsOf,
} from '../testing/index.ts';
import { attemptSchedule, nextAttemptAt } from './attempt-schedule.ts';

const anyWords: unknown = expect.any(String);

const minute = 60_000;

describe('the schedule of the attempts of a delivery', () => {
  it('makes five attempts, the others 1, 2, 4 and 8 minutes after the one before', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => nextAttemptAt({ attempt, endedAt: 0 }))).toEqual([
      minute,
      2 * minute,
      4 * minute,
      8 * minute,
      undefined,
    ]);
    expect(attemptSchedule.attempts).toBe(5);
  });

  it('waits longer when a tool server asks it to, within the longest wait of the schedule', () => {
    expect(nextAttemptAt({ attempt: 1, endedAt: 100, retryAfterMs: 30_000 })).toBe(100 + minute);
    expect(nextAttemptAt({ attempt: 1, endedAt: 100, retryAfterMs: 3 * minute })).toBe(100 + 3 * minute);
    expect(nextAttemptAt({ attempt: 2, endedAt: 100, retryAfterMs: 60 * minute })).toBe(100 + 8 * minute);
  });
});

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

describe('the due work of the open requests on a run of another capability', () => {
  it('delivers its request and records the delivery beside the facts that capability declares on the run', async () => {
    const tools = fakeTools();
    const playbook = interactionHarness({ tools, others: [nudging] });
    await playbook.defineAs('nudging', 'forecast', 'Confirm the forecast?');
    await playbook.askAs('nudging', 'forecast', {}, runId);
    await Effect.runPromise(
      playbook.record(
        { org: 'acme', playbook: 'alpha', id: runId },
        { type: 'work', fact: { type: 'nudge_sent', data: { number: 1 } } },
        { causationId: null, correlationId: runId },
      ),
    );

    await playbook.performDue(Date.now());

    expect(tools.posted()).toMatchObject([{ channel: '#forecast-sales', text: 'Confirm the forecast?' }]);
    expect(
      (await recordsOf(playbook.ledger, 'nudge_sent', 'delivery_started', 'delivery_succeeded')).map(
        ({ type }) => type,
      ),
    ).toEqual(['nudge_sent', 'delivery_started', 'delivery_succeeded']);
    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'started' } });
    expect(
      await playbook.call(defineGetRunHistory(makeDefinitionPresenters(playbook.capabilities), runContentHolders), {
        run_id: runId,
      }),
    ).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          { type: 'nudge_sent', summary: 'Nudged.', data: { number: 1 } },
          { type: 'delivery_started' },
          { type: 'delivery_succeeded' },
        ],
      },
    });
  });
});

const alpha = { org: 'acme', playbook: 'alpha' };

const keptRunId = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const input = { campaign: 'Spring', owner: 'ada', brief: 'b'.repeat(4096) };

const RecordedSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: Schema.JsonObject });

const decodeRecorded = Schema.decodeUnknownSync(Schema.Array(RecordedSchema));

async function typesOn(ledger: ReturnType<typeof ledgerKeepingNames>, run: string) {
  const { records } = await Effect.runPromise(
    ledger.service.readRecorded(alpha, { kind: 'run', run }, { order: 'asc', limit: 20 }),
  );
  return decodeRecorded(records);
}

async function askedWithAKeptInput(held: boolean) {
  const watched = watchedStore();
  const ledger = ledgerKeepingNames([openRequests], runContentHolders, watched.store);
  const asked = await askedThroughChat({ ledger });
  const [, deferral] = await typesOn(ledger, askedRunId);
  const { sha256, bytes } = keptArmOf(input);
  const named = { playbookKey: 'playbook/acme/alpha/', definitionType: 'interaction', name: 'approve-brief' };
  const holder = Option.getOrThrow(Option.fromNullishOr(await Effect.runPromise(ledger.service.holderOfName(named))));
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
        `${holder.definitionKey}runs/${keptRunId}`,
        [
          {
            type: 'run_started',
            data: {
              input_sha256: sha256,
              input_bytes: bytes,
              started_by: { id: 'acme-admin', name: 'acme-admin' },
              playbook: 'alpha',
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
          detail: anyWords,
        },
      },
    ]);
  });
});
