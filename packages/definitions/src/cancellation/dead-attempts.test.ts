import { InvalidInput, Ledger, type Lineage } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  defineCapability,
  runCanceller,
  type Capability,
  type CancelOfALiveAttempt,
  type CancelRequest,
} from '../index.ts';
import type { RunCommand } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { keptArmOf, keptIn, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const runId = '0199a3c4-7d2e-7c1a-9b3f-0000000000d1';

const alpha = { org: 'acme', playbook: 'alpha' };

const address = { ...alpha, id: runId };

const stream = `playbook/acme/alpha/runs/${runId}`;

const lineage: Lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId };

const longestCallMs = 70_000;

const deadline: CancelRequest = {
  kind: 'deadline',
  reason: 'The step that waited for this run ran out of time, so it no longer needs it',
};

const parentEnded: CancelRequest = { kind: 'parent_ended', reason: 'The run that waited for this run ended first' };

const effectUnknown =
  'its attempt ended while it called a tool that may change something, so whether that call did is not known';

const nothingChanged = "every tool it called only reads, by its server's own account, so nothing was changed";

function systemCall(parses = true): Capability {
  return defineCapability({
    type: 'system-call',
    title: 'System call',
    guide: { name: 'system-call' },
    noun: { one: 'system call', other: 'system calls' },
    describeOutput: () => 'It called a system.',
    mediaType: 'text/plain',
    parse: (source: string) =>
      parses ? Effect.succeed(source) : Effect.fail(new InvalidInput({ detail: 'It no longer parses', issues: [] })),
    summarize: () => ({}),
    run: () => Effect.never,
    reachesOutside: true,
    mayChangeOutside: true,
    callsTools: () => true,
    longestRunOf: () => longestCallMs,
  });
}

function momentAfter(ms: number): string {
  return new Date(Date.parse(firstMoment) + ms).toISOString();
}

const acted = { runId, by: 'acme-admin', at: firstMoment };

function startOfTheRun(version = 1): RunCommand {
  return {
    type: 'start',
    definition_type: 'system-call',
    name: 'post',
    input: {},
    started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
    definition_version: version,
    calls_tools: true,
    ...acted,
  };
}

const sent = { server: 'slack', tool: 'post_message', arguments_bytes: 2 };

function callStarted(number: number): RunCommand {
  return { type: 'call', fact: { type: 'tool_call_started', data: { call_id: `toolu_${number}`, ...sent } }, ...acted };
}

const readingCallStarted: RunCommand = {
  type: 'call',
  fact: { type: 'tool_call_started', data: { call_id: 'toolu_1', ...sent, read_only: true } },
  ...acted,
};

const callAnswered: RunCommand = {
  type: 'call',
  fact: {
    type: 'tool_call_answered',
    data: { number: 1, is_error: false, result_bytes: 2, duration_ms: 5, jsonrpc_id: 1 },
  },
  ...acted,
};

const keptInput = { brief: 'b'.repeat(4096) };

function startedWithAKeptInput(service: Ledger['Service']) {
  const { sha256, bytes } = keptArmOf(keptInput);
  const context = { ...acted, definitionType: 'system-call', definitionName: 'post', definitionVersion: 1 };
  const data = { input_sha256: sha256, input_bytes: bytes, started_by: recordedAdmin, calls_tools: true } as const;
  return Effect.andThen(
    keptIn(service.content, alpha, keptInput),
    recordedAsGiven(service, stream, [{ type: 'run_started', data }], context),
  );
}

async function leftByItsAttempt(facts: readonly RunCommand[], version?: number, inputKept = false) {
  const capability = systemCall();
  const operations = definitionOperationsFor([capability]);
  const watched = watchedStore();
  const definitions = harness(undefined, watched.store);
  const { service } = definitions.ledger;
  await definitions.call(
    operations.createDefinition,
    toAlpha(acmeAdmin, { type: 'system-call', name: 'post', source: 'post' }),
  );
  const starting = inputKept
    ? startedWithAKeptInput(service)
    : Effect.asVoid(service.execute(stream, runDecider, startOfTheRun(version)));
  await definitions.run(
    Effect.orDie(
      Effect.andThen(
        starting,
        Effect.forEach(facts, (command) => service.execute(stream, runDecider, command)),
      ),
    ),
  );
  const lookedAtAgain: CancelOfALiveAttempt[] = [];
  const lookAgain = (cancel: CancelOfALiveAttempt) => Effect.sync(() => lookedAtAgain.push(cancel));
  return {
    service,
    watched,
    lookedAtAgain,
    cancelling: (
      request: CancelRequest,
      afterMs: number,
      capabilities: readonly Capability[] = [capability],
      ledger: Ledger['Service'] = service,
    ) =>
      definitions.run(
        Effect.orDie(runCanceller(ledger, capabilities, lookAgain)(address, request, lineage)),
        momentAfter(afterMs),
      ),
    cancellingWithNoShellToLook: (request: CancelRequest, afterMs: number) =>
      definitions.run(
        Effect.orDie(runCanceller(service, [capability])(address, request, lineage)),
        momentAfter(afterMs),
      ),
    reading: () => definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: runId })),
    recorded: async () => {
      const read = service.readRecorded(alpha, { kind: 'run', run: runId }, { order: 'asc', limit: 20 });
      const { records } = await definitions.run(Effect.orDie(read));
      return records.map(({ type, data }) => ({ type, data }));
    },
  };
}

function cancelledWith(request: CancelRequest, detail = request.reason) {
  return { output: { status: 'rejected', rejection: { reason: 'cancelled', kind: request.kind, detail } } };
}

const started = { output: { status: 'started' } };

describe('a cancel its caller makes of a run within its call whose attempt died', () => {
  it('ends the run rejected as cancelled with the kind of the cancel, the call it left open ended as interrupted', async () => {
    const { cancelling, reading, recorded, lookedAtAgain } = await leftByItsAttempt([callStarted(1)]);

    const receipt = await cancelling(deadline, longestCallMs + 1);

    expect([receipt, lookedAtAgain]).toEqual(['requested', []]);
    expect(await reading()).toMatchObject(cancelledWith(deadline, `${deadline.reason}; ${effectUnknown}`));
    expect(await recorded()).toMatchObject([
      { type: 'run_started' },
      { type: 'tool_call_started' },
      { type: 'run_cancel_requested', data: { kind: 'deadline', reason: deadline.reason } },
      { type: 'tool_call_failed', data: { number: 1, because: 'interrupted', duration_ms: 0, jsonrpc_id: null } },
      { type: 'run_rejected' },
    ]);
  });

  it('says nothing was changed when every tool it called is one its server marks read-only', async () => {
    const { cancelling, reading } = await leftByItsAttempt([readingCallStarted]);

    await cancelling(parentEnded, longestCallMs + 1);

    expect(await reading()).toMatchObject(cancelledWith(parentEnded, `${parentEnded.reason}; ${nothingChanged}`));
  });

  it('keeps the reason of the cancel alone when the run called no tool, or its tool answered', async () => {
    const calledNothing = await leftByItsAttempt([]);
    const answered = await leftByItsAttempt([callStarted(1), callAnswered]);

    await calledNothing.cancelling(deadline, longestCallMs + 1);
    await answered.cancelling(deadline, longestCallMs + 1);

    expect([await calledNothing.reading(), await answered.reading()]).toMatchObject([
      cancelledWith(deadline),
      cancelledWith(deadline),
    ]);
  });
});

describe('a cancel its caller makes of a run within its call whose attempt may be live', () => {
  it('records the cancel alone while the run has been quiet no longer than its run may take, and one asked once it has been quiet longer ends it with the first kind', async () => {
    const { cancelling, reading, lookedAtAgain } = await leftByItsAttempt([callStarted(1)]);

    await cancelling(deadline, longestCallMs);
    const whileLive = await reading();
    const askedToLookAgain = [...lookedAtAgain];
    await cancelling(parentEnded, 2 * longestCallMs + 1);

    expect(whileLive).toMatchObject(started);
    expect([askedToLookAgain, lookedAtAgain]).toEqual([
      [{ run: address, request: deadline, lineage, quietForMs: longestCallMs }],
      [{ run: address, request: deadline, lineage, quietForMs: longestCallMs }],
    ]);
    expect(await reading()).toMatchObject(cancelledWith(deadline, `${deadline.reason}; ${effectUnknown}`));
  });

  it('records the cancel alone where no shell looks again, and ends the run as one asked later', async () => {
    const { cancellingWithNoShellToLook, reading } = await leftByItsAttempt([callStarted(1)]);

    await cancellingWithNoShellToLook(deadline, longestCallMs);
    const whileLive = await reading();
    await cancellingWithNoShellToLook(deadline, 2 * longestCallMs + 1);

    expect(whileLive).toMatchObject(started);
    expect(await reading()).toMatchObject(cancelledWith(deadline, `${deadline.reason}; ${effectUnknown}`));
  });

  it('records the cancel alone when the run changed between its read and the cancel', async () => {
    const { service, cancelling, reading, recorded, lookedAtAgain } = await leftByItsAttempt([callStarted(1)]);
    const writingMeanwhile = Ledger.of({
      ...service,
      ageOfLastAppend: () =>
        Effect.as(Effect.orDie(service.execute(stream, runDecider, callStarted(2))), Number.POSITIVE_INFINITY),
    });

    await cancelling(deadline, longestCallMs + 1, [systemCall()], writingMeanwhile);

    expect(await reading()).toMatchObject(started);
    expect(lookedAtAgain).toMatchObject([{ quietForMs: longestCallMs }]);
    expect(await recorded()).toMatchObject([
      { type: 'run_started' },
      { type: 'tool_call_started' },
      { type: 'tool_call_started' },
      { type: 'run_cancel_requested' },
    ]);
  });
});

describe('a cancel its caller makes of a run within its call whose definition cannot be read again', () => {
  it('records the cancel alone: no capability of its type, a version not recorded, or one that no longer parses', async () => {
    const unknownType = await leftByItsAttempt([callStarted(1)]);
    const unrecorded = await leftByItsAttempt([callStarted(1)], 9);
    const unparsed = await leftByItsAttempt([callStarted(1)]);

    await unknownType.cancelling(deadline, longestCallMs + 1, []);
    await unrecorded.cancelling(deadline, longestCallMs + 1);
    await unparsed.cancelling(deadline, longestCallMs + 1, [systemCall(false)]);

    expect([await unknownType.reading(), await unrecorded.reading(), await unparsed.reading()]).toMatchObject([
      started,
      started,
      started,
    ]);
    expect([unknownType.lookedAtAgain, unrecorded.lookedAtAgain, unparsed.lookedAtAgain]).toEqual([[], [], []]);
  });
});

describe('a cancel its caller makes of a run within its call whose input its playbook keeps outside the run', () => {
  it('judges the attempt with the input read, and ends the run whose attempt died as any', async () => {
    const { cancelling, reading } = await leftByItsAttempt([callStarted(1)], undefined, true);

    await cancelling(deadline, longestCallMs + 1);

    expect(await reading()).toMatchObject(cancelledWith(deadline, `${deadline.reason}; ${effectUnknown}`));
  });

  it('records the cancel alone where the input cannot be read, judging no attempt by a bound it cannot know', async () => {
    const { cancelling, reading, lookedAtAgain, watched } = await leftByItsAttempt([callStarted(1)], undefined, true);
    watched.fail();

    expect(await cancelling(deadline, longestCallMs + 1)).toBe('requested');
    expect([await reading(), lookedAtAgain]).toMatchObject([started, []]);
  });
});
