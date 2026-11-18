import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { financePrefix, projected } from '../testing/projected.ts';
import type { RecordedFact } from '../testing/recorded-facts.ts';
import { dismissalRows } from './dismissal-rows.ts';

const assessment = '6f1c7a2e-3b4d-5e6f-8a9b-0c1d2e3f4a5b';

const stream = `${financePrefix}assessments/${assessment}`;

const context = { at: '2026-11-09T18:00:00.000Z', by: 'person:user_2ada' };

const fact = (type: string, data: Schema.JsonObject): RecordedFact => ({ type, data, context });

const thing = { goal: 'orders', per: 'ORD-3', by: { id: 'person:user_2ada', name: 'Ada Lovelace' } };

const dismissed = (at: string, requests: readonly string[]) =>
  fact('goal_dismissed', { ...thing, at, requests: [...requests] });

const restored = (at: string) => fact('goal_restored', { ...thing, at });

async function rowAfter(...facts: readonly RecordedFact[]) {
  const dismissals = projected(dismissalRows);
  await dismissals.record(stream, ...facts);
  return (await dismissals.rows())[assessment];
}

describe('the row of a thing’s dismissals, under the thing’s id', () => {
  it('stands while its latest dismissal fact is a dismissal, naming the goal, when, who and the requests it set aside', async () => {
    expect(await rowAfter(dismissed('2026-11-09T18:00:00.000Z', ['run-1', 'run-2']))).toEqual({
      dismissed: true,
      at: Date.parse('2026-11-09T18:00:00.000Z'),
      goal: 'orders',
      by: 'person:user_2ada',
      requests: JSON.stringify(['run-1', 'run-2']),
    });
  });

  it('no longer stands once the thing is restored, and stands again with the next dismissal’s requests alone', async () => {
    const back = await rowAfter(dismissed('2026-11-09T18:00:00.000Z', ['run-1']), restored('2026-11-09T19:00:00.000Z'));
    const again = await rowAfter(
      dismissed('2026-11-09T18:00:00.000Z', ['run-1']),
      restored('2026-11-09T19:00:00.000Z'),
      dismissed('2026-11-09T20:00:00.000Z', ['run-3']),
    );

    expect(back).toMatchObject({ dismissed: false, requests: '[]' });
    expect(again).toMatchObject({ dismissed: true, at: Date.parse('2026-11-09T20:00:00.000Z'), requests: '["run-3"]' });
  });

  it('keeps no row for the other facts of a thing', async () => {
    expect(await rowAfter(fact('goal_assessment_ended', { reason: 'no_result' }))).toBeUndefined();
  });
});
