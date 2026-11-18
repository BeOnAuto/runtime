import { Conflict, Ledger } from '@on.auto/operations';
import { mostInlinePayloadBytes, payloadMembers, PayloadOffloading } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  cancelledAsAsked,
  type CalledRun,
  type CancelledRun,
  type CancelOfALiveAttempt,
  type CancelRequest,
  type Capability,
  deferredCanceller,
  defineCancelRun,
  defineCapability,
  runCanceller,
  type Settlement,
} from '../index.ts';
import { cancelsAt, longestCallMs } from '../read-model-testing/dead-attempt-cancels.ts';
import type { RunCommand } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, runStreamIn, toPlaybook } from '../testing/harness.ts';
import { keptIn, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';
import { cancelledAt, relayedId, withHandOn } from '../testing/relaying.ts';

const someWords: unknown = expect.any(String);

const asStarted = {
  run_id: relayedId,
  type: 'relay',
  name: 'hand-on',
  definition_version: 1,
  status: 'started',
  started_at: firstMoment,
  started_by: { id: 'acme-admin', name: 'acme-admin' },
};

const everything = { kind: 'everything' } as const;

const aMinuteAfterItStarted = '2026-10-01T09:01:00.000Z';

const relayed = { org: 'acme', playbook: 'alpha', id: relayedId, definitionType: 'relay', name: 'hand-on' };

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: relayedId };

const deadline: CancelRequest = { kind: 'deadline', reason: 'The step that waited for it ran out of time' };

const systemCall: Capability = defineCapability({
  type: 'system-call',
  title: 'System call',
  guide: { name: 'system-call' },
  noun: { one: 'system call', other: 'system calls' },
  describeOutput: () => 'It called a system.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.never,
  reachesOutside: true,
  mayChangeOutside: true,
  callsTools: () => true,
  longestRunOf: () => longestCallMs,
});

const alpha = { org: 'acme', playbook: 'alpha' };

const relayedKeptAnswerCancels = { ...alpha, id: relayedId };

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

const runId = '0199a3c4-7d2e-7c1a-9b3f-0000000000d2';

const address = { org: 'acme', playbook: 'alpha', id: runId, definitionType: 'system-call', name: 'post' };

const lineageKeptDocumentCancels = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId };

const longestCallMsKeptDocumentCancels = 70_000;

const deadlineKeptDocumentCancels: CancelRequest = {
  kind: 'deadline',
  reason: 'The step that waited for this run ran out of time',
};

const posting = defineCapability({
  type: 'system-call',
  title: 'System call',
  guide: { name: 'system-call' },
  noun: { one: 'system call', other: 'system calls' },
  describeOutput: () => 'It called a system.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.never,
  reachesOutside: true,
  mayChangeOutside: true,
  callsTools: () => true,
  longestRunOf: () => longestCallMsKeptDocumentCancels,
});

const operations = definitionOperationsFor([posting]);

const toAlpha = toPlaybook('acme', 'alpha');

const acted = { runId, by: 'acme-admin', at: firstMoment };

const started: RunCommand = {
  type: 'start',
  definition_type: 'system-call',
  name: 'post',
  input: {},
  started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
  playbook: 'alpha',
  definition_version: 1,
  calls_tools: true,
  ...acted,
};

const calling: RunCommand = {
  type: 'call',
  fact: {
    type: 'tool_call_started',
    data: { call_id: 'toolu_1', server: 'slack', tool: 'post_message', arguments_bytes: 2 },
  },
  fencingToken: 1,
  ...acted,
};

const longPost = `Post to the channel the playbook names. ${'and more '.repeat(Math.ceil(mostInlinePayloadBytes / 9))}`;

async function cancelledLate({ readable }: { readonly readable: boolean }) {
  const watched = watchedStore();
  const definitions = harness(undefined, watched.store);
  const { service } = definitions.ledger;
  await definitions.run(
    definitions
      .dispatch(
        operations.createDefinition,
        toAlpha(acmeAdmin, { type: 'system-call', name: 'post', source: longPost }),
      )
      .pipe(Effect.provideService(PayloadOffloading, true)),
  );
  const stream = runStreamIn(definitions.ledger, { type: 'system-call', name: 'post' }, runId);
  await definitions.run(
    Effect.orDie(
      Effect.andThen(service.execute(stream, runDecider, started), service.execute(stream, runDecider, calling)),
    ),
  );
  if (!readable) {
    watched.fail();
  }
  const lookedAtAgain: CancelOfALiveAttempt[] = [];
  const lookAgain = (cancel: CancelOfALiveAttempt) => Effect.sync(() => lookedAtAgain.push(cancel));
  const at = new Date(Date.parse(firstMoment) + longestCallMsKeptDocumentCancels + 1).toISOString();
  await definitions.run(
    Effect.orDie(
      runCanceller(service, [posting], lookAgain)(address, deadlineKeptDocumentCancels, lineageKeptDocumentCancels),
    ),
    at,
  );
  const read = await definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: runId }), at);
  return { lookedAtAgain, read };
}

describe('cancel_run', () => {
  it('records the request on a run that finishes later, with its caller and reason, and answers the run as it stands', async () => {
    const { cancelling, running, history } = await withHandOn();
    await running();

    expect(await cancelling({ reason: 'Not needed any more' })).toStrictEqual({
      status: 'succeeded',
      output: asStarted,
    });
    expect(await history()).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          {
            type: 'run_cancel_requested',
            summary: someWords,
            data: { kind: 'requested', reason: 'Not needed any more' },
            metadata: { at: cancelledAt, run_id: relayedId, by: 'acme-admin' },
          },
        ],
      },
    });
  });
});

describe('cancel_run asked again, or without a reason', () => {
  it('says who asked when no reason is given, and records nothing more when asked again before the run ended', async () => {
    const { cancelling, running, ledger, run } = await withHandOn();
    await running();
    await cancelling();
    await cancelling({ reason: 'Asked again' });

    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(
      records.filter(({ type }) => type === 'run_cancel_requested').map(({ data, context }) => [data, context]),
    ).toEqual([
      [
        { kind: 'requested', reason: 'Cancelled at the request of acme-admin' },
        {
          at: cancelledAt,
          by: 'acme-admin',
          runId: relayedId,
          definitionType: 'relay',
          definitionName: 'hand-on',
          definitionVersion: 1,
        },
      ],
    ]);
  });
});

describe('a cancel request on a run', () => {
  it('is put in the tree of the run, caused by nothing, as a request from outside is', async () => {
    const { cancelling, running, ledger, run } = await withHandOn();
    await running();
    await cancelling();

    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(records.at(-1)).toMatchObject({
      type: 'run_cancel_requested',
      causationId: null,
      correlationId: relayedId,
    });
  });

  it('is a conflict for a run that has ended, and for one that runs within its call while its attempt may be live', async () => {
    const { call, cancelling, cancelRun, runDefinition, running, prober, settling } = await withHandOn();
    await running();
    await settling({ status: 'succeeded', output: 'handed on', record: {} });
    const plain = '0199a3c4-7d2e-7c1a-9b3f-000000000001';
    prober.sufferOnNextRun('stall');
    void call(runDefinition, toPlaybook('acme', 'alpha')(acmeAdmin, { type: 'probe', name: 'plain', run_id: plain }));
    await prober.stalled;

    expect([
      await cancelling(),
      await call(cancelRun, toPlaybook('acme', 'alpha')(acmeAdmin, { run_id: plain }), aMinuteAfterItStarted),
    ]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: someWords,
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: someWords,
      },
    ]);
  });
});

describe('cancel_run of a run the playbook does not have, or with a reason it cannot keep', () => {
  it('is not found', async () => {
    const { cancelling } = await withHandOn();

    expect(await cancelling({}, '0199a3c4-7d2e-7c1a-9b3f-00000000ffff')).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no such run in this playbook',
    });
  });

  it('refuses a reason that is blank, too long or holds a control character', async () => {
    const { cancelling, running } = await withHandOn();
    await running();

    const refusals = [
      await cancelling({ reason: '   ' }),
      await cancelling({ reason: 'x'.repeat(1025) }),
      await cancelling({ reason: 'stop\u0007' }),
    ];

    expect(refusals).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
    ]);
  });
});

describe('the operation of cancelling a run', () => {
  const { registration } = defineCancelRun([echo]);

  it('says in plain words what it tried and that the run is being cancelled', () => {
    expect([
      registration.plainLanguage?.attempt({ run_id: relayedId }),
      registration.plainLanguage?.outcome({ ...asStarted, type: 'echo', name: 'greet' }, { run_id: relayedId }),
    ]).toEqual(['cancel the run', expect.stringContaining('“greet”')]);
  });
});

describe('a cancel request the workflow host records on a run', () => {
  it('is requested on a run that finishes later, by the playbook itself unless an actor is named, with the lineage given', async () => {
    const { running, ledger, run } = await withHandOn();
    await running();
    const cancel = runCanceller(ledger.service);

    const receipt = await Effect.runPromise(cancel(relayed, deadline, lineage));
    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(receipt).toBe('requested');
    expect(records.at(-1)).toMatchObject({
      type: 'run_cancel_requested',
      ...lineage,
      data: { kind: 'deadline', reason: deadline.reason },
      context: { by: 'playbook:alpha' },
    });
  });

  it('answers that the run has ended, and records the request on a run within its call, on a run not started yet, but not for a name no definition of the playbook holds nor at an ill-formed address', async () => {
    const { call, runDefinition, running, ledger, prober, settling } = await withHandOn();
    await running();
    await settling({ status: 'failed' });
    const plain = '0199a3c4-7d2e-7c1a-9b3f-000000000001';
    prober.sufferOnNextRun('stall');
    void call(runDefinition, toPlaybook('acme', 'alpha')(acmeAdmin, { type: 'probe', name: 'plain', run_id: plain }));
    await prober.stalled;
    const cancel = runCanceller(ledger.service);

    const addresses: readonly CalledRun[] = [
      relayed,
      { ...relayed, id: plain },
      { ...relayed, id: '0199a3c4-7d2e-7c1a-9b3f-00000000ffff' },
      { ...relayed, id: '0199a3c4-7d2e-7c1a-9b3f-00000000fffe', name: 'held-by-none' },
      { ...relayed, id: 'not-a-run' },
      { ...relayed, playbook: 'al/pha' },
    ];
    const receipts = await Effect.runPromise(
      Effect.forEach(addresses, (run) => cancel(run, { ...deadline, by: 'acme-admin' }, lineage)),
    );

    expect(receipts).toEqual(['ended', 'requested', 'requested', 'unknown_run', 'unknown_run', 'unknown_run']);
  });
});

describe('a cancel request the stream refuses otherwise', () => {
  it('fails with that conflict, so it is tried again', async () => {
    const changed = new Conflict({
      detail: 'The state changed while the command was decided',
      kind: 'concurrent_change',
    });
    const { ledger } = await withHandOn();
    const changing = Ledger.of({ ...ledger.service, execute: () => Effect.fail(changed) });

    expect(await Effect.runPromise(Effect.flip(runCanceller(changing)(relayed, deadline, lineage)))).toBe(changed);
  });
});

describe('the longest run of a version a cancel judges an attempt by, staged between today and the read model', () => {
  it('is compared at reads, read from the read model at on, and a dead attempt ends as it does today', async () => {
    const today = await cancelsAt(systemCall);

    expect([await cancelsAt(systemCall, 'reads'), await cancelsAt(systemCall, 'on')]).toEqual([
      { reads: today.reads, compared: [['matched'], ['matched']] },
      { reads: today.reads, compared: [[], []] },
    ]);
  });
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
        `${String(ledger.names().find(({ name }) => name === 'hand-on')?.definitionKey)}runs/${relayedId}`,
        [{ type: 'request_answered', data: answered }],
        onTheRun,
      ),
    );

    await Effect.runPromise(deferredCanceller([passingItsAnswerOn], service)(relayedKeptAnswerCancels, asked, lineage));
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

    await Effect.runPromise(
      deferredCanceller([passingItsAnswerOn], ledger.service)(relayedKeptAnswerCancels, asked, lineage),
    );

    expect(await reading()).toMatchObject({ output: { rejection: { reason: 'cancelled', detail: asked.reason } } });
  });
});

describe('a cancel its caller makes of a run within its call whose document its playbook keeps outside its facts', () => {
  it('judges the attempt by the bound the document it reads gives, ending the run whose attempt died', async () => {
    const { read } = await cancelledLate({ readable: true });

    expect(read).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'deadline' } },
    });
  });

  it('records the cancel alone where the document cannot be read, judging no attempt by a bound it cannot know', async () => {
    const { read, lookedAtAgain } = await cancelledLate({ readable: false });

    expect([read, lookedAtAgain]).toMatchObject([{ status: 'succeeded', output: { status: 'started' } }, []]);
  });
});
