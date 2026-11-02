import { describe, expect, it } from 'vitest';

import { financePrefix, projected } from '../testing/projected.ts';
import {
  definitionCreated,
  definitionRetired,
  definitionUpdated,
  messageOf,
  runFailed,
  runRejected,
  runStarted,
  runSucceeded,
  type RecordedFact,
  type RunOf,
} from '../testing/recorded-facts.ts';
import { brokenRows } from './broken-rows.ts';

const invoice = { type: 'reasoning', name: 'categorize-invoice' };

const runAt = (version: number, index: number): RunOf => ({
  ...invoice,
  version,
  runId: `0199fe31-2a4b-7c5d-8e6f-00000000000${index}`,
  trigger: { kind: 'event', reference: 'invoice-received' },
});

const at = (minute: number) => `2026-11-01T15:${String(minute).padStart(2, '0')}:00.000Z`;

const definitions = `${financePrefix}definitions/reasoning`;

const runs = (run: RunOf) => `${financePrefix}runs/${run.runId}`;

const key = 'reasoning/categorize-invoice';

async function brokenAfter(...steps: readonly (readonly [string, RecordedFact])[]) {
  const { record, rows } = projected(brokenRows);
  await record(definitions, definitionCreated({ ...invoice, version: 1 }, at(0), 'person:user_2ada'));
  await steps.reduce((done: Promise<void>, [stream, fact]) => done.then(() => record(stream, fact)), Promise.resolve());
  return (await rows())[key];
}

describe('the broken definitions of the activity', () => {
  it('opens the row of a definition whose run at its current version failed or was rejected', async () => {
    const one = runAt(1, 1);
    const two = runAt(1, 2);

    expect(await brokenAfter([runs(one), runFailed(one, at(1))])).toEqual({
      open: true,
      at: Date.parse(at(1)),
      status: 'failed',
      definition_type: 'reasoning',
      definition_name: 'categorize-invoice',
      version: 1,
      current_version: 1,
      run_id: one.runId,
      detail: null,
      ended_by: 'playbook:finance',
      trigger: JSON.stringify({ kind: 'event', reference: 'invoice-received' }),
    });
    expect(
      await brokenAfter(
        [runs(one), runFailed(one, at(1))],
        [runs(two), runRejected(two, at(2), 'unavailable', 'The tool ledger/post_entry is not offered.\nMore')],
      ),
    ).toMatchObject({
      open: true,
      at: Date.parse(at(2)),
      status: 'rejected',
      run_id: two.runId,
      detail: 'The tool ledger/post_entry is not offered.',
    });
    expect(await brokenAfter([runs(one), runRejected(one, at(1), 'unavailable', ' ')])).toMatchObject({
      open: true,
      detail: null,
    });
  });
});

describe('a cancelled run, an unanswered request or a step', () => {
  it('writes nothing for a cancelled run, which is neither a failure nor a success', async () => {
    const one = runAt(1, 1);

    expect(await brokenAfter([runs(one), runRejected(one, at(1), 'cancelled', 'Cancelled')])).toMatchObject({
      open: false,
      run_id: null,
    });
  });

  it('writes nothing for a request nobody answered, which closes the request alone', async () => {
    const one = runAt(1, 1);

    expect(await brokenAfter([runs(one), runRejected(one, at(1), 'unanswered', 'Nobody answered')])).toMatchObject({
      open: false,
      run_id: null,
    });
  });

  it('opens nothing for a run a workflow called', async () => {
    const step = {
      ...runAt(1, 1),
      calledBy: { runId: '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e', reference: 'x', run: 1 },
    };

    expect(await brokenAfter([runs(step), runFailed(step, at(1))])).toMatchObject({ open: false });
  });
});

describe('a broken definition resolved', () => {
  it('resolves when a run at that version or a later one succeeds, and not when an older version succeeds', async () => {
    const twoBroke = runAt(2, 1);
    const oneSucceeded = runAt(1, 2);
    const twoSucceeded = runAt(2, 3);
    const savedTwo: readonly [string, RecordedFact] = [
      definitions,
      definitionUpdated({ ...invoice, version: 2 }, at(1), 'x'),
    ];

    expect(
      await brokenAfter(
        savedTwo,
        [runs(twoBroke), runFailed(twoBroke, at(2))],
        [runs(oneSucceeded), runSucceeded(oneSucceeded, at(3))],
      ),
    ).toMatchObject({ open: true, version: 2 });
    expect(
      await brokenAfter(
        savedTwo,
        [runs(twoBroke), runFailed(twoBroke, at(2))],
        [runs(twoSucceeded), runSucceeded(twoSucceeded, at(3))],
      ),
    ).toMatchObject({ open: false, version: 2, run_id: twoBroke.runId });
  });

  it('resolves when a new version is saved or the definition is retired, and a run of the old version opens nothing', async () => {
    const one = runAt(1, 1);
    const late = runAt(1, 2);

    expect(
      await brokenAfter(
        [runs(one), runFailed(one, at(1))],
        [definitions, definitionUpdated({ ...invoice, version: 2 }, at(2), 'x')],
        [runs(late), runFailed(late, at(3))],
      ),
    ).toMatchObject({ open: false, current_version: 2, run_id: one.runId });
    expect(
      await brokenAfter(
        [runs(one), runFailed(one, at(1))],
        [definitions, definitionRetired({ ...invoice, version: 1 }, at(2), 'x')],
      ),
    ).toMatchObject({ open: false });
  });
});

describe('a definition broken again', () => {
  it('opens again at the time of a new break, and keeps a failure of an older version from moving it back', async () => {
    const two = runAt(2, 1);
    const one = runAt(1, 2);
    const fact = runFailed(one, at(4));

    expect(brokenRows.rowAfter({ open: true, version: 2, current_version: null }, messageOf(fact))).toBeUndefined();
    expect(
      await brokenAfter(
        [definitions, definitionUpdated({ ...invoice, version: 2 }, at(1), 'x')],
        [runs(two), runFailed(two, at(2))],
        [runs(two), runSucceeded(two, at(3))],
        [runs(two), runFailed(two, at(5))],
      ),
    ).toMatchObject({ open: true, at: Date.parse(at(5)) });
  });
});

describe('what keeps no broken definition', () => {
  it('keys nothing without a definition, folds nothing it cannot read, and retires nothing it never kept', () => {
    const one = runAt(1, 1);
    const started = messageOf(runStarted(one, at(0), 'x'));

    expect(
      brokenRows.keyOf?.({ ...started, context: { at: at(0), by: 'x' } }, { kind: 'runs', id: one.runId }),
    ).toBeUndefined();
    expect(brokenRows.keyOf?.(started, { kind: 'runs', id: one.runId })).toBe(key);
    expect(
      brokenRows.rowAfter(undefined, { ...messageOf(runFailed(one, at(1))), data: { incident: 3 } }),
    ).toBeUndefined();
    expect(brokenRows.rowAfter(undefined, started)).toBeUndefined();
    expect(
      brokenRows.rowAfter(undefined, messageOf(definitionRetired({ ...invoice, version: 1 }, at(1), 'x'))),
    ).toBeUndefined();
    expect(brokenRows.rowAfter(undefined, messageOf(runSucceeded(one, at(1))))).toBeUndefined();
    expect(brokenRows.rowAfter(undefined, messageOf(runFailed(one, at(1))))).toMatchObject({
      open: true,
      current_version: null,
    });
  });
});
