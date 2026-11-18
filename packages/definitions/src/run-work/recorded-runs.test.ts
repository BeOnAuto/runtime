import {
  PlaybookContext,
  PlaybookReader,
  playbookLedgerOf,
  type RecordedEvent,
  type RecordedPage,
  RunCancelled,
} from '@on.auto/operations';
import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Context, Effect, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  answeredAlready,
  cancelledBeforeItsStartIn,
  type CancelRequest,
  playbookBoundAnswerer,
  recordedRunIn,
  recordedRunInPlaybook,
  runCanceller,
  runCorrelationIn,
  runEventOf,
  runStartCursorIn,
} from '../index.ts';
import type { GivenAnswer } from '../runs/run-commands.ts';
import {
  answering,
  asked,
  askedRunId,
  attempted,
  askedLineage as lineage,
  question,
  askedRun as run,
} from '../testing/asked-runs.ts';
import { askedRequest } from '../testing/asking.ts';
import { recordedAdmin, startedInAlpha } from '../testing/callers.ts';
import { harness } from '../testing/harness.ts';
import { definedWithItsId, keptArmOf, keptIn, recordedAsGiven, watchedStore } from '../testing/kept-payloads.ts';
import { admittingMeter } from '../testing/recording-meter.ts';
import { nestedRunId } from './nested-run-ids.ts';

describe('a run as it was recorded', () => {
  it('is read by its address or by its id in its playbook, and is nothing for a run there is not', async () => {
    const { ledger } = await asked();
    const read = await Effect.runPromise(recordedRunIn(ledger.service, run));

    expect(read).toMatchObject({
      run: { run_id: askedRunId, status: 'started', record: { ...askedRequest, message: question } },
      input: { inline: { campaign: 'Spring' } },
      awaitsSettlement: true,
      work: [],
      answer: null,
      depth: 0,
      callDepth: 0,
    });
    expect(
      await Effect.runPromise(
        recordedRunInPlaybook(
          Context.get(playbookLedgerOf(ledger.service, { org: 'acme', playbook: 'alpha' }), PlaybookReader),
          askedRunId.toUpperCase(),
        ),
      ),
    ).toEqual(read);
    expect(
      await Effect.runPromise(
        recordedRunInPlaybook(
          Context.get(playbookLedgerOf(ledger.service, { org: 'acme', playbook: 'alpha' }), PlaybookReader),
          'not-a-run',
        ),
      ),
    ).toBeUndefined();
    expect(await Effect.runPromise(recordedRunIn(ledger.service, { ...run, id: 'not-a-run' }))).toBeUndefined();
    expect(
      await Effect.runPromise(recordedRunIn(ledger.service, { ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' })),
    ).toBeUndefined();
    expect(runEventOf({ type: 'run_failed', data: { incident: 1 } })).toBeUndefined();
  });
});

const deadline: CancelRequest = { kind: 'deadline', reason: 'The step that waited for this run ran out of time' };

describe('a run its caller cancelled before its start, as its stream reads', () => {
  it('is the cancel every start of it is refused with, and nothing for a run that started, one there is not, or an address no playbook holds', async () => {
    const { ledger } = await asked();
    const cancelled = { ...run, id: '0199a3c4-7d2e-7c1a-9b3f-0000000000c2' };
    await Effect.runPromise(
      runCanceller(ledger.service)({ ...cancelled, definitionType: 'asking', name: 'approve' }, deadline, {
        causationId: null,
        correlationId: cancelled.id,
      }),
    );
    const readOf = (address: Readonly<typeof run>) =>
      Effect.runPromise(cancelledBeforeItsStartIn(ledger.service, address));

    expect([
      await readOf({ ...cancelled, id: cancelled.id.toUpperCase() }),
      await readOf(run),
      await readOf({ ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' }),
      await readOf({ ...run, id: 'not-a-run' }),
    ]).toEqual([new RunCancelled({ detail: deadline.reason, kind: 'deadline' }), undefined, undefined, undefined]);
  });
});

describe('the correlation of a run', () => {
  it('is read from the first record of its stream, the run at the top of its tree, itself for a run nothing started', async () => {
    const { ledger } = await asked();

    expect(await Effect.runPromise(runCorrelationIn(ledger.service, run))).toBe(askedRunId);
  });
});

describe('the start of a run in the order of the ledger', () => {
  it('is the cursor of the first record of its stream, from which a read goes on to what was recorded before it', async () => {
    const { ledger } = await asked();
    const start = await Effect.runPromise(runStartCursorIn(ledger.service, run));
    const before = await Effect.runPromise(
      ledger.service.readRecorded(run, { kind: 'everything' }, { order: 'desc', limit: 100, cursor: start }),
    );
    const first = await Effect.runPromise(
      ledger.service.readRecorded(run, { kind: 'run', run: run.id }, { order: 'asc', limit: 1 }),
    );
    const earlier = before.records.map(({ globalPosition }) => globalPosition);

    expect(earlier.length).toBeGreaterThan(0);
    expect(
      first.records.map(({ cursor, type, globalPosition }) => ({
        cursor,
        type,
        notEarlier: earlier.filter((at) => at >= globalPosition),
      })),
    ).toEqual([{ cursor: start, type: 'run_started', notEarlier: [] }]);
  });
});

function recordedAt(version: number): RecordedEvent {
  return {
    id: `record-${version}`,
    causationId: null,
    correlationId: `correlation-${version}`,
    stream: `runs/${run.id}`,
    version,
    globalPosition: version,
    type: version === 1 ? 'run_started' : 'tool_call_started',
    data: undefined,
    context: { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' },
    recordedAt: '2026-10-01T09:00:00.000Z',
    cursor: `cursor-${version}`,
  };
}

const pages: ReadonlyMap<string, RecordedPage> = new Map([
  ['newest', { records: [recordedAt(3), recordedAt(2)], hasMore: true, nextCursor: 'older', lastExamined: null }],
  ['older', { records: [recordedAt(1)], hasMore: false, nextCursor: null, lastExamined: null }],
]);

const pagedRun = {
  readRecorded: (_: unknown, __: unknown, { cursor = 'newest' }: { readonly cursor?: string }) =>
    Effect.succeed(pages.get(cursor) ?? { records: [], hasMore: false, nextCursor: null, lastExamined: null }),
};

describe('the first record of a run, read newest first', () => {
  it('is the oldest record of the run, read back page after page where the run holds more than a page', async () => {
    expect([
      await Effect.runPromise(runStartCursorIn(pagedRun, run)),
      await Effect.runPromise(runCorrelationIn(pagedRun, run)),
    ]).toEqual(['cursor-1', 'correlation-1']);
  });

  it('is a plain failure for a run the playbook does not have', async () => {
    const { ledger } = await asked();
    const missing = { ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' };

    await expect(Effect.runPromise(runStartCursorIn(ledger.service, missing))).rejects.toThrow(
      `There is no run ${missing.id} in this playbook to read the first record of`,
    );
  });
});

const inputValue = { i: 'i'.repeat(3000) };

const outputValue = { o: 'o'.repeat(3000) };

const answerValue = { a: 'a'.repeat(3000) };

const keptInput = keptArmOf(inputValue);

const keptOutput = keptArmOf(outputValue);

const keptAnswer = keptArmOf(answerValue);

const keptRunId = '0199a3c4-7d2e-7c1a-9b3f-0000000000b1';

const askingId = '0199a3c4-7d2e-7c1a-9b3f-0000000000a1';

async function aRunKeptOutside() {
  const watched = watchedStore();
  const { ledger } = harness(admittingMeter, watched.store);
  await Effect.runPromise(
    definedWithItsId(
      ledger.service,
      { org: 'acme', playbook: 'alpha' },
      {
        type: 'asking',
        name: 'ask',
        source: 'Ask?',
        id: askingId,
      },
    ),
  );
  const context = {
    runId: keptRunId,
    by: 'acme-admin',
    at: '2026-10-01T09:00:00.000Z',
    definitionType: 'asking',
    definitionName: 'ask',
    definitionVersion: 1,
  };
  const started = { input_sha256: keptInput.sha256, input_bytes: keptInput.bytes, ...startedInAlpha };
  const answered = { answer_sha256: keptAnswer.sha256, answer_bytes: keptAnswer.bytes, answered_by: recordedAdmin };
  const succeeded = { output_sha256: keptOutput.sha256, output_bytes: keptOutput.bytes, record: {} };
  const alpha = { org: 'acme', playbook: 'alpha' };
  await Effect.runPromise(
    Effect.andThen(
      Effect.forEach([inputValue, outputValue, answerValue], (value: Schema.Json) =>
        keptIn(ledger.service.content, alpha, value),
      ),
      recordedAsGiven(
        ledger.service,
        `definition/acme/${askingId}/runs/${keptRunId}`,
        [
          { type: 'run_started', data: { ...started, finishes_later: true } },
          { type: 'run_deferred', data: { record: { to: 'ada' } } },
          { type: 'request_answered', data: answered },
          { type: 'run_succeeded', data: succeeded },
        ],
        context,
      ),
    ),
  );
  return { ledger, watched };
}

const thePlaybook = { id: 'playbook:alpha', name: 'alpha' };

const answer = { choice: 'approve', reason: 'r'.repeat(17_000) };

const kept = keptArmOf(answer);

const keptAnswerKeptAnswerWrites = { answer_sha256: kept.sha256, answer_bytes: kept.bytes };

function keepingOutside<A, E>(effect: Effect.Effect<A, E>) {
  return attempted(effect.pipe(Effect.provideService(PayloadOffloading, true)));
}

const nameBasedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('a run whose payloads its playbook keeps outside the run, as it was recorded', () => {
  it('carries its input, output and answer by their digests and sizes, reading none of them', async () => {
    const { ledger, watched } = await aRunKeptOutside();
    const address = { org: 'acme', playbook: 'alpha', id: keptRunId };

    expect(await Effect.runPromise(recordedRunIn(ledger.service, address))).toMatchObject({
      run: { status: 'succeeded', output: { kept: keptOutput } },
      input: { kept: keptInput },
      answer: { answer: { kept: keptAnswer } },
      awaitsSettlement: false,
    });
    expect(watched.reads()).toBe(0);
  });
});

describe('the answer to a request, where its playbook keeps large values outside its runs', () => {
  it('is kept once, before the fact that names it, and the same answer in another order again records nothing', async () => {
    const { record, recorded, ledger } = await asked();

    const first = await keepingOutside(record(run, answering(answer, 'ada'), lineage));
    const again = await keepingOutside(
      record(run, answering({ reason: answer.reason, choice: answer.choice }, 'grace'), lineage),
    );
    const text = await Effect.runPromise(ledger.service.content.getHead(run, kept.sha256));

    expect(Result.map(again, ({ id }) => id)).toEqual(Result.map(first, ({ id }) => id));
    expect((await recorded()).slice(2).map(({ type, data }) => [type, data])).toEqual([
      ['request_answered', { ...keptAnswerKeptAnswerWrites, claimed_for: 'ada', answered_by: thePlaybook }],
    ]);
    expect(text).toMatchObject({ bytes: kept.bytes, mediaType: 'application/json' });
  });

  it('is refused for another answer once one is kept, telling them apart by the one it reads', async () => {
    const { record } = await asked();
    await keepingOutside(record(run, answering(answer), lineage));

    expect(await keepingOutside(record(run, answering({ ...answer, choice: 'reject' }), lineage))).toEqual(
      Result.fail(answeredAlready),
    );
  });

  it('is given by a caller within the playbook, kept the same way, and another large answer after it is a conflict', async () => {
    const { ledger, recorded } = await asked();
    const ada = { id: 'person:ada', name: 'Ada Lovelace' };
    const answeredWith = (given: GivenAnswer) =>
      keepingOutside(
        playbookBoundAnswerer(run.id, given, ada, lineage).pipe(
          Effect.provideContext(playbookLedgerOf(ledger.service, run)),
          Effect.provideService(PlaybookContext, { org: run.org, playbook: run.playbook }),
        ),
      );

    const results = [
      await answeredWith({ answer }),
      await answeredWith({ answer: { reason: answer.reason, choice: answer.choice } }),
      await answeredWith({ answer: { ...answer, choice: 'reject' } }),
    ];

    expect(results).toMatchObject([{ _tag: 'Success' }, { _tag: 'Success' }, Result.fail(answeredAlready)]);
    expect((await recorded()).slice(2).map(({ type, data }) => [type, data])).toEqual([
      ['request_answered', { ...keptAnswerKeptAnswerWrites, answered_by: ada }],
    ]);
  });
});

describe('the id of a run another run starts', () => {
  it('is a name-based UUID, the same for the same run, task and run of the task', () => {
    const id = nestedRunId('run-1', '/do/0/ask', 1);

    expect(id).toMatch(nameBasedUuid);
    expect(nestedRunId('run-1', '/do/0/ask', 1)).toBe(id);
  });

  it('is the id the runs already started were given, so a child started again is the same run', () => {
    expect([
      nestedRunId('run-1', '/do/0/ask', 1),
      nestedRunId('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '/do/0/judge', 2),
      nestedRunId('run-1', '/do/0/naïve', 1),
    ]).toEqual([
      'ae7e2bc1-745e-50af-805b-41d801887d11',
      'fa69afbd-33e5-52d8-9b80-0074bb97e33c',
      'b631d0fa-bf40-5e88-9f35-d21b8c0836e2',
    ]);
  });

  it('differs for another run, another task or another run of the task', () => {
    const ids = new Set([
      nestedRunId('run-1', '/do/0/ask', 1),
      nestedRunId('run-2', '/do/0/ask', 1),
      nestedRunId('run-1', '/do/1/ask', 1),
      nestedRunId('run-1', '/do/0/ask', 2),
    ]);

    expect(ids.size).toBe(4);
  });
});
