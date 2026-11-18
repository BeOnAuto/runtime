import { streamAddressed } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { aDefinition, definitionPrefix, projected } from '../testing/projected.ts';
import {
  definitionCreated,
  definitionUpdated,
  messageOf,
  runFailed,
  type RunOf,
  runStarted,
  runSucceeded,
} from '../testing/recorded-facts.ts';
import { lineOf, mostLineCharacters } from './activity-facts.ts';
import { activityRows } from './activity-rows.ts';

describe('the one line a row keeps of a text', () => {
  it('is its first line, trimmed', () => {
    expect(lineOf('  Approve this?  \r\nThe invoice is attached.')).toBe('Approve this?');
  });

  it(`is cut at ${mostLineCharacters} characters with an ellipsis, counting each character once`, () => {
    const line = lineOf('🧾'.repeat(mostLineCharacters + 1));

    expect(Array.from(line)).toHaveLength(mostLineCharacters);
    expect(line.endsWith('🧾…')).toBe(true);
    expect(lineOf('a'.repeat(mostLineCharacters))).toBe('a'.repeat(mostLineCharacters));
  });
});

const closeTheWeek: RunOf = {
  runId: '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e',
  type: 'workflow',
  name: 'close-the-week',
  version: 4,
  trigger: { kind: 'cron', reference: 'weekly' },
};

const step: RunOf = {
  runId: '019a4012-7c3e-7d10-9b2a-000000000001',
  type: 'reasoning',
  name: 'categorize-invoice',
  version: 7,
  calledBy: { runId: closeTheWeek.runId, reference: 'categorize', run: 1 },
};

const runStream = (runId: string) => `${definitionPrefix}runs/${runId}`;

const at = (minute: number) => `2026-11-01T17:0${minute}:00.000Z`;

const ms = (minute: number) => Date.parse(at(minute));

describe('the runs among the new items of the activity', () => {
  it('keeps a run no other run started, listed once it succeeds, with who started it, its trigger and output shape', async () => {
    const { record, rows } = projected(activityRows, aDefinition);
    await record(runStream(closeTheWeek.runId), runStarted(closeTheWeek, at(0), 'person:user_7kLm2', 'table'));
    const started = await rows();
    await record(runStream(closeTheWeek.runId), runSucceeded(closeTheWeek, at(2)));

    expect(started).toEqual({
      [`runs/${closeTheWeek.runId}`]: {
        listed: false,
        at: null,
        by: 'person:user_7kLm2',
        change: null,
        definition_type: 'workflow',
        definition_name: 'close-the-week',
        definition_version: 4,
        run_id: closeTheWeek.runId,
        trigger: JSON.stringify({ kind: 'cron', reference: 'weekly' }),
        output_shape: 'table',
      },
    });
    expect((await rows())[`runs/${closeTheWeek.runId}`]).toMatchObject({ listed: true, at: ms(2) });
  });

  it('keeps no row for a run a workflow called, whether it starts or succeeds', async () => {
    const { record, rows } = projected(activityRows, aDefinition);
    await record(runStream(step.runId), runStarted(step, at(0), 'person:user_7kLm2'), runSucceeded(step, at(1)));

    expect(await rows()).toEqual({});
  });

  it('lists a run that succeeded with no start it folded, as started by whoever ended it', () => {
    const succeeded = messageOf(runSucceeded({ ...closeTheWeek, trigger: undefined }, at(3)));

    expect(activityRows.rowAfter(undefined, succeeded)).toMatchObject({
      listed: true,
      at: ms(3),
      by: 'playbook:finance',
      output_shape: null,
      trigger: null,
    });
  });
});

describe('the versions among the new items of the activity', () => {
  it('lists each version of a definition saved, created or updated, and by whom', async () => {
    const { record, rows } = projected(activityRows, aDefinition);
    const invoice = { type: 'reasoning', name: 'categorize-invoice' };
    await record(
      `${definitionPrefix}definitions/reasoning`,
      definitionCreated({ ...invoice, version: 1 }, at(0), 'person:user_2ada'),
      definitionUpdated({ ...invoice, version: 2 }, at(1), 'person:user_7kLm2'),
    );
    const kept = await rows();

    expect(Object.keys(kept)).toEqual([
      'definitions/reasoning/categorize-invoice/1',
      'definitions/reasoning/categorize-invoice/2',
    ]);
    expect(kept['definitions/reasoning/categorize-invoice/1']).toMatchObject({
      listed: true,
      at: ms(0),
      by: 'person:user_2ada',
      change: 'created',
      definition_version: 1,
      run_id: null,
    });
    expect(kept['definitions/reasoning/categorize-invoice/2']).toMatchObject({
      at: ms(1),
      by: 'person:user_7kLm2',
      change: 'updated',
      definition_version: 2,
    });
  });

  it('keys nothing for a definition fact without its definition, and folds nothing it cannot read', () => {
    const saved = messageOf(
      definitionUpdated({ type: 'reasoning', name: 'categorize-invoice', version: 2 }, at(1), 'x'),
    );
    const unread = { ...messageOf(runStarted(closeTheWeek, at(0), 'x')), data: {} };

    expect(
      activityRows.keyOf?.(
        { ...saved, context: { at: at(1), by: 'x' } },
        streamAddressed('definition/acme/d1/definitions/reasoning'),
      ),
    ).toBeUndefined();
    expect(activityRows.rowAfter(undefined, unread)).toBeUndefined();
    expect(activityRows.rowAfter(undefined, messageOf(runFailed(closeTheWeek, at(1))))).toBeUndefined();
  });
});

const notice: RunOf = {
  runId: '019a4012-7c3e-7d10-9b2a-00000000000a',
  type: 'interaction',
  name: 'tell-owner',
  version: 1,
  trigger: { kind: 'goal', reference: 'goals/paying-customers/assessments/6f1c7a2e-3b4d-5e6f-8a9b-0c1d2e3f4a5b' },
};

describe('a notice among the new items of the activity', () => {
  it('keeps no row: a run a goal started is told to its owner, never a new result', async () => {
    const { record, rows } = projected(activityRows, aDefinition);
    await record(runStream(notice.runId), runStarted(notice, at(0), 'playbook:finance'));
    await record(runStream(notice.runId), runSucceeded(notice, at(1)));

    expect(await rows()).toEqual({});
  });
});
