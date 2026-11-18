import { InvalidInput, Ledger } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type RunJournal } from '../index.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook, runStreamIn, type Harness } from '../testing/harness.ts';
import { keptArmOf, keptIn, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-0000000000e1';

function streamIn(ledger: Harness['ledger']): string {
  return runStreamIn(ledger, { type: 'system-call', name: 'post' }, runId);
}

const longestCallMs = 70_000;

const at = { runId, by: 'acme-admin', at: firstMoment };

const sent = { server: 'slack', tool: 'post_message', arguments_bytes: 2 };

type CallsBeforeItDies = 'none' | 'acting' | 'acting answered, then reading';

function callsMadeIn(journal: RunJournal, calls: CallsBeforeItDies): Effect.Effect<void, unknown> {
  const acting = journal.record({ type: 'tool_call_started', data: { call_id: 'toolu_1', ...sent } });
  const answered = { is_error: false, result_bytes: 2, duration_ms: 5, jsonrpc_id: 1 };
  const reading = { type: 'tool_call_started', data: { call_id: 'toolu_2', ...sent, read_only: true } } as const;
  const madeOf: Readonly<Record<CallsBeforeItDies, Effect.Effect<unknown, unknown>>> = {
    none: Effect.void,
    acting,
    'acting answered, then reading': Effect.flatMap(acting, (number) =>
      Effect.andThen(
        journal.record({ type: 'tool_call_answered', data: { number, ...answered } }),
        journal.record(reading),
      ),
    ),
  };
  return Effect.asVoid(madeOf[calls]);
}

function aCallWhoseProcessDies(calls: CallsBeforeItDies) {
  const ending = Promise.withResolvers<void>();
  const document = { parses: true };
  const capability = defineCapability({
    type: 'system-call',
    title: 'System call',
    guide: { name: 'system-call' },
    noun: { one: 'system call', other: 'system calls' },
    describeOutput: () => 'It called a system.',
    mediaType: 'text/plain',
    parse: (source: string) =>
      document.parses ? Effect.succeed(source) : Effect.fail(new InvalidInput({ detail: 'No longer', issues: [] })),
    summarize: () => ({}),
    run: (_source, _input, { journal }) =>
      Effect.orDie(callsMadeIn(journal, calls)).pipe(
        Effect.andThen(
          Effect.sync(() => {
            ending.resolve();
          }),
        ),
        Effect.andThen(Effect.never),
      ),
    reachesOutside: true,
    mayChangeOutside: true,
    callsTools: () => true,
    longestRunOf: () => longestCallMs,
  });
  const parsesNoMore = () => {
    document.parses = false;
  };
  return { capability, reachedItsEnd: ending.promise, parsesNoMore };
}

function momentAfter(ms: number): string {
  return new Date(Date.parse(firstMoment) + ms).toISOString();
}

async function aRunAClientStartedWhoseProcessDied(calls: CallsBeforeItDies = 'acting') {
  const dying = aCallWhoseProcessDies(calls);
  const operations = definitionOperationsFor([dying.capability]);
  const definitions = harness();
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'system-call', name: 'post', source: 'post' }),
  );
  void definitions.call(
    operations.runDefinition,
    toAlpha(acmeAdmin, { type: 'system-call', name: 'post', input: {}, run_id: runId }),
  );
  await dying.reachedItsEnd;
  const cancelRequest = toAlpha(acmeAdmin, { run_id: runId });
  return {
    service: definitions.ledger.service,
    stream: streamIn(definitions.ledger),
    parsesNoMore: dying.parsesNoMore,
    reading: (afterMs: number) => definitions.call(operations.getRun, cancelRequest, momentAfter(afterMs)),
    cancelling: (afterMs: number) => definitions.call(operations.cancelRun, cancelRequest, momentAfter(afterMs)),
    cancellingWithoutItsCapability: (afterMs: number) =>
      definitions.call(definitionOperationsFor([echo]).cancelRun, cancelRequest, momentAfter(afterMs)),
    cancellingOver: (ledger: Ledger['Service'], afterMs: number) =>
      definitions.run(
        definitions.dispatch(operations.cancelRun, cancelRequest).pipe(Effect.provideService(Ledger, ledger)),
        momentAfter(afterMs),
      ),
    history: () => definitions.call(operations.getRunHistory, cancelRequest),
  };
}

async function aRunWhoseInputItsPlaybookKeepsOutside() {
  const { capability } = aCallWhoseProcessDies('acting');
  const operations = definitionOperationsFor([capability]);
  const watched = watchedStore();
  const definitions = harness(undefined, watched.store);
  const { service } = definitions.ledger;
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'system-call', name: 'post', source: 'post' }),
  );
  const input = { brief: 'b'.repeat(4096) };
  const { sha256, bytes } = keptArmOf(input);
  const context = { ...at, definitionType: 'system-call', definitionName: 'post', definitionVersion: 1 };
  const data = {
    input_sha256: sha256,
    input_bytes: bytes,
    started_by: recordedAdmin,
    playbook: 'alpha',
    calls_tools: true,
  } as const;
  const kept = keptIn(service.content, { org: 'acme', playbook: 'alpha' }, input);
  await definitions.run(
    Effect.orDie(
      Effect.andThen(
        kept,
        recordedAsGiven(service, streamIn(definitions.ledger), [{ type: 'run_started', data }], context),
      ),
    ),
  );
  return {
    readsNothingMore: watched.fail,
    cancelling: (afterMs: number) =>
      definitions.call(operations.cancelRun, toAlpha(acmeAdmin, { run_id: runId }), momentAfter(afterMs)),
  };
}

const askedBy = 'Cancelled at the request of acme-admin';

const effectUnknown =
  'its attempt ended while it called a tool that may change something, so whether that call did is not known';

function cancelledAsDead(detail: string) {
  return {
    status: 'succeeded',
    output: { run_id: runId, status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested', detail } },
  };
}

const leftStarted = { status: 'succeeded', output: { run_id: runId, status: 'started' } };

const refusedWithinItsCall = {
  status: 'rejected',
  reason: 'conflict',
  detail:
    'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
};

describe('a run a client started within its call, whose process died in the middle of it', () => {
  it('is left started, and a cancel asked once it has been quiet longer than such a run may take ends it, its open call ended as interrupted', async () => {
    const { reading, cancelling, history } = await aRunAClientStartedWhoseProcessDied();

    const longAfter = await reading(longestCallMs + 1);
    const cancelled = await cancelling(longestCallMs + 1);

    expect(longAfter).toMatchObject(leftStarted);
    expect(cancelled).toMatchObject(cancelledAsDead(`${askedBy}; ${effectUnknown}`));
    expect(await history()).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          { type: 'tool_call_started' },
          { type: 'run_cancel_requested' },
          { type: 'tool_call_failed', data: { number: 1, because: 'interrupted' } },
          { type: 'run_rejected' },
        ],
      },
    });
  });

  it('is ended by that cancel with its reason alone where it died before it called any tool', async () => {
    const { cancelling } = await aRunAClientStartedWhoseProcessDied('none');

    expect(await cancelling(longestCallMs + 1)).toMatchObject(cancelledAsDead(askedBy));
  });

  it('is still refused a cancel while it has been quiet no longer than such a run may take, since its attempt may be live', async () => {
    const { reading, cancelling } = await aRunAClientStartedWhoseProcessDied();

    expect(await cancelling(longestCallMs)).toMatchObject(refusedWithinItsCall);
    expect(await reading(longestCallMs)).toMatchObject(leftStarted);
  });
});

describe('a run a client started within its call, whose process died while a call that only reads was open', () => {
  it('is ended with the reason of the cancel alone, though the call before it may have acted', async () => {
    const { cancelling, history } = await aRunAClientStartedWhoseProcessDied('acting answered, then reading');

    expect(await cancelling(longestCallMs + 1)).toMatchObject(cancelledAsDead(askedBy));
    expect(await history()).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          { type: 'tool_call_started' },
          { type: 'tool_call_answered' },
          { type: 'tool_call_started' },
          { type: 'run_cancel_requested' },
          { type: 'tool_call_failed', data: { number: 2, because: 'interrupted' } },
          { type: 'run_rejected' },
        ],
      },
    });
  });
});

describe('a cancel of a run within its call whose attempt cannot be judged', () => {
  it('is refused as before where no capability of its type is served, or its version no longer parses', async () => {
    const unserved = await aRunAClientStartedWhoseProcessDied();
    const unparsed = await aRunAClientStartedWhoseProcessDied();
    unparsed.parsesNoMore();

    expect([
      await unserved.cancellingWithoutItsCapability(longestCallMs + 1),
      await unparsed.cancelling(longestCallMs + 1),
    ]).toMatchObject([refusedWithinItsCall, refusedWithinItsCall]);
    expect(await unparsed.reading(longestCallMs + 1)).toMatchObject(leftStarted);
  });

  it('is refused as before where the input its playbook keeps outside the run cannot be read just now, and judged once it can', async () => {
    const unread = await aRunWhoseInputItsPlaybookKeepsOutside();
    const read = await aRunWhoseInputItsPlaybookKeepsOutside();
    unread.readsNothingMore();

    expect([await unread.cancelling(longestCallMs + 1), await read.cancelling(longestCallMs + 1)]).toMatchObject([
      refusedWithinItsCall,
      { status: 'succeeded', output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'requested' } } },
    ]);
  });

  it('is refused as before where its attempt recorded a fact between the read and the cancel, and records nothing', async () => {
    const { service, stream, cancellingOver, history } = await aRunAClientStartedWhoseProcessDied();
    const anotherCall = { call_id: 'toolu_2', ...sent };
    const recordingMeanwhile = Ledger.of({
      ...service,
      ageOfLastAppend: () =>
        Effect.as(
          Effect.orDie(
            service.execute(stream, runDecider, {
              type: 'call',
              fact: { type: 'tool_call_started', data: anotherCall },
              fencingToken: 1,
              ...at,
            }),
          ),
          Number.POSITIVE_INFINITY,
        ),
    });

    expect(await cancellingOver(recordingMeanwhile, longestCallMs + 1)).toMatchObject(refusedWithinItsCall);
    expect(await history()).toMatchObject({
      output: { events: [{ type: 'run_started' }, { type: 'tool_call_started' }, { type: 'tool_call_started' }] },
    });
  });
});
