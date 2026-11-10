import { payloadMembers } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { cancelledAsAsked, deferredCanceller, defineCapability, type CancelledRun, type Settlement } from '../index.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { keptIn, recordedAsGiven } from '../testing/kept-payloads.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const relayed = { ...alpha, id: relayedId };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: relayedId };

const asked = { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' } as const;

const answer = { approved: true, notes: 'n'.repeat(4096) };

function answerPassedOn(run: CancelledRun): Settlement {
  return run.answer === null
    ? cancelledAsAsked(run)
    : { status: 'succeeded', ...payloadMembers('output', run.answer.answer), record: {} };
}

const passingItsAnswerOn = defineCapability({
  type: 'relay',
  title: 'Relay',
  guide: { name: 'relay' },
  noun: { one: 'relay', other: 'relays' },
  describeOutput: () => 'It handed its input on.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.succeed({ finishesLater: true, record: {} }),
  cancel: answerPassedOn,
});

describe('a cancel of a run that took an answer its playbook keeps outside the run', () => {
  it('passes the answer on by its digest into the settlement its capability decides, reading nothing, and the run ends with it', async () => {
    const { running, ledger, reading } = await withHandOn();
    await running();
    const { service } = ledger;
    const kept = await Effect.runPromise(keptIn(service.content, alpha, answer));
    const onTheRun = {
      runId: relayedId,
      by: 'acme-admin',
      at: '2026-10-01T09:30:00.000Z',
      definitionType: 'relay',
      definitionName: 'hand-on',
      definitionVersion: 1,
    };
    const answered = { answer_sha256: kept.sha256, answer_bytes: kept.bytes, answered_by: recordedAdmin };
    await Effect.runPromise(
      recordedAsGiven(
        service,
        `playbook/acme/alpha/runs/${relayedId}`,
        [{ type: 'request_answered', data: answered }],
        onTheRun,
      ),
    );

    await Effect.runPromise(deferredCanceller([passingItsAnswerOn], service)(relayed, asked, lineage));
    const { records } = await Effect.runPromise(
      service.readRecorded(alpha, { kind: 'run', run: relayedId }, { order: 'desc', limit: 1 }),
    );

    expect(records.map(({ type, data }) => ({ type, data }))).toEqual([
      { type: 'run_succeeded', data: { output_sha256: kept.sha256, output_bytes: kept.bytes, record: {} } },
    ]);
    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: answer } });
  });

  it('cancels as asked a run that took no answer', async () => {
    const { running, ledger, reading } = await withHandOn();
    await running();

    await Effect.runPromise(deferredCanceller([passingItsAnswerOn], ledger.service)(relayed, asked, lineage));

    expect(await reading()).toMatchObject({ output: { rejection: { reason: 'cancelled', detail: asked.reason } } });
  });
});
