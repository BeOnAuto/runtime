import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aDefinition, definitionPrefix, projected } from '../testing/projected.ts';
import type { RecordedFact } from '../testing/recorded-facts.ts';
import { goalOverdueRows, goalVerdictRows } from './goal-rows.ts';

const assessment = '6f1c7a2e-3b4d-5e6f-8a9b-0c1d2e3f4a5b';

const stream = `${definitionPrefix}assessments/${assessment}`;

const key = `assessments/${assessment}`;

const context = { at: '2026-11-09T18:00:00.000Z', by: 'playbook:finance' };

const fact = (type: string, data: Schema.JsonObject): RecordedFact => ({ type, data, context });

const opened = fact('goal_assessment_opened', {
  goal_version: 1,
  rule: { settles: 'on_crossing', target: { at_least: 1 } },
  milestones: [],
});

const observed = (shownWords: { readonly title?: string; readonly says: string }) =>
  fact('goal_observed', {
    source: { record: 'record-1', run: 'run-1', workflow: 'measure', version: 1, entry: 0 },
    at: '2026-11-09T19:00:00.000Z',
    says: shownWords.says,
    ...(shownWords.title === undefined ? {} : { title: shownWords.title }),
  });

const overdue = (told: string) => fact('goal_overdue', { since: '2026-11-10T17:00:00.000Z', told });

const assessed = (told: string) =>
  fact('goal_assessed', { verdict: 'passed', at: '2026-11-11T09:00:00.000Z', by: 'final', told });

const ended = fact('goal_assessment_ended', { reason: 'no_result' });

async function rowsAfter(...facts: readonly RecordedFact[]) {
  const verdicts = projected(goalVerdictRows, aDefinition);
  const overdues = projected(goalOverdueRows, aDefinition);
  await verdicts.record(stream, ...facts);
  await overdues.record(stream, ...facts);
  return { verdict: (await verdicts.rows())[key], overdue: (await overdues.rows())[key] };
}

const shown = { title: 'Webinar', says: 'Two customers' };

describe('the bell’s rows of a goal', () => {
  it('are kept under the goal’s own key, which names the goal they are of', () => {
    expect([goalVerdictRows.scopes, goalOverdueRows.scopes]).toEqual([['definition'], ['definition']]);
  });
});

describe('the bell’s rows of a verdict', () => {
  it('are kept from the opening under the assessment, and listed by whoever judged it once the verdict is one the owner is told of', async () => {
    const { verdict } = await rowsAfter(
      opened,
      observed({ title: 'Webinar', says: 'Two customers' }),
      assessed('summary'),
      observed({ title: 'Webinar', says: 'Later words' }),
    );

    expect(verdict).toEqual({
      listed: true,
      by: 'playbook:finance',
      at: Date.parse(context.at),
      result_at: Date.parse('2026-11-11T09:00:00.000Z'),
      outcome: 'passed',
      ...shown,
    });
  });

  it('are kept unlisted for a verdict the owner asked not to hear of, and take only the first verdict', async () => {
    const quiet = await rowsAfter(
      opened,
      opened,
      observed({ says: 'Two customers' }),
      assessed('quiet'),
      assessed('now'),
    );

    expect(quiet.verdict).toMatchObject({ listed: false, outcome: 'passed', title: null, says: 'Two customers' });
  });

  it('are none for an assessment never opened', async () => {
    expect(
      await rowsAfter(observed({ title: 'Webinar', says: 'Two customers' }), assessed('now'), overdue('now'), ended),
    ).toEqual({
      verdict: undefined,
      overdue: undefined,
    });
  });
});

describe('the bell’s rows of an overdue', () => {
  it('are open while the assessment is overdue, with its words, and closed by its verdict', async () => {
    const before = await rowsAfter(opened, overdue('now'), observed({ title: 'Webinar', says: 'Two customers' }));
    const after = await rowsAfter(
      opened,
      overdue('now'),
      observed({ title: 'Webinar', says: 'Two customers' }),
      assessed('now'),
    );

    expect([before.overdue, after.overdue]).toEqual([
      { open: true, at: Date.parse('2026-11-10T17:00:00.000Z'), by: 'playbook:finance', outcome: 'overdue', ...shown },
      { open: false, at: Date.parse('2026-11-10T17:00:00.000Z'), by: 'playbook:finance', outcome: 'overdue', ...shown },
    ]);
    expect(after.verdict).toMatchObject({ listed: true, outcome: 'passed' });
  });

  it('are closed by its ending, never open for an overdue the owner asked not to hear of, and overdue once', async () => {
    const endedRows = await rowsAfter(opened, overdue('summary'), ended, ended);
    const quiet = await rowsAfter(opened, overdue('quiet'), overdue('now'));

    expect([endedRows.overdue?.['open'], quiet.overdue?.['open'], quiet.overdue?.['outcome']]).toEqual([
      false,
      false,
      'overdue',
    ]);
  });
});
