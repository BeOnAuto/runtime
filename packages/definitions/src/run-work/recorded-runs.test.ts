import type { RecordedEvent, RecordedPage, StreamWriter } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  playbookBoundSettler,
  recordedRunIn,
  recordedRunInPlaybook,
  runCorrelationIn,
  runEventOf,
  runStartCursorIn,
} from '../index.ts';
import { asked, askedRun as run, askedRunId, attempted, question } from '../testing/asked-runs.ts';
import { askedRequest } from '../testing/asking.ts';

describe('a run as it was recorded', () => {
  it('is read by its address or by its id in its playbook, and is nothing for a run there is not', async () => {
    const { ledger } = await asked();
    const read = await Effect.runPromise(recordedRunIn(ledger.service, run));

    expect(read).toMatchObject({
      run: { run_id: askedRunId, status: 'started', record: { ...askedRequest, message: question } },
      input: { campaign: 'Spring' },
      awaitsSettlement: true,
      work: [],
      answer: null,
      depth: 0,
      callDepth: 0,
    });
    expect(
      await Effect.runPromise(
        recordedRunInPlaybook(
          { load: (relative, decider) => ledger.service.load(`playbook/acme/alpha/${relative}`, decider) },
          askedRunId.toUpperCase(),
        ),
      ),
    ).toEqual(read);
    expect(await Effect.runPromise(recordedRunIn(ledger.service, { ...run, id: 'not-a-run' }))).toBeUndefined();
    expect(
      await Effect.runPromise(recordedRunIn(ledger.service, { ...run, id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' })),
    ).toBeUndefined();
    expect(runEventOf({ type: 'run_failed', data: { incident: 1 } })).toBeUndefined();
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

describe('a settlement made through the writer of a playbook', () => {
  it('settles a run of that playbook by its id, and finds no run under an id that is not one', async () => {
    const { ledger } = await asked();
    const writer: StreamWriter = {
      execute: (relative, decider, command, given) =>
        ledger.service.execute(`playbook/acme/alpha/${relative}`, decider, command, given),
    };
    const settle = playbookBoundSettler(writer);

    expect(
      await Effect.runPromise(settle(run, { status: 'succeeded', output: { choice: 'approve' }, by: 'acme-admin' })),
    ).toMatchObject({ status: 'succeeded', output: { choice: 'approve' } });
    expect(await attempted(settle({ ...run, id: 'nope' }, { status: 'failed' }))).toMatchObject(
      Result.fail({ _tag: 'not_found' }),
    );
  });
});
