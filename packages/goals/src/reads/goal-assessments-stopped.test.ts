import { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';
import {
  afterSpan,
  assessmentBookOf,
  day,
  experimentsGoal,
  firstDay,
  instantText,
  thingAt,
  type AssessmentBook,
} from './assessment-samples.ts';
import { goalAssessmentsIn } from './goal-assessments.ts';

const hour = 3_600_000;

const live = firstDay + day;

const noSale = 'No order came in, and the experiment page was taken down.';

function stoppedColumnsOf(book: AssessmentBook, id: string) {
  return book.inThePlaybook(
    PlaybookReader.use((reader) =>
      Effect.map(
        reader.readProjectedRows(assessmentsName, {
          where: [{ column: 'row_key', equals: id }],
          orderBy: [],
          order: 'asc',
          limit: 1,
        }),
        ([kept]) => [kept?.row['stopped_at'], kept?.row['stopped_run']],
      ),
    ),
  );
}

function read(book: AssessmentBook) {
  return book.inThePlaybook(goalAssessmentsIn(experimentsGoal));
}

function liveThing(book: AssessmentBook, per: string): Promise<string> {
  return thingAt(book, { per, at: firstDay, marked: ['chosen', 'prepared', 'live'], live });
}

async function stoppedByItsMeasurement(book: AssessmentBook): Promise<string> {
  const id = await liveThing(book, 'MAR-1');
  await book.observed(id, live + hour, {
    measurement: { value: 0, final: true, as_of: live + hour },
    says: noSale,
  });
  return id;
}

describe('the stopped assessments of a goal', () => {
  it('say when, by which run and why each one stopped, are counted, and stay open with no verdict', async () => {
    const book = assessmentBookOf();
    const measured = await stoppedByItsMeasurement(book);
    const failed = await liveThing(book, 'MAR-2');
    await book.stopped(failed, 'failed-run', live + 2 * hour, 'The lookup of the orders failed.');
    const going = await liveThing(book, 'MAR-3');
    const unexplained = await liveThing(book, 'MAR-4');
    await book.observed(unexplained, live + 3 * hour, {
      measurement: { value: 0, final: true, as_of: live + 3 * hour },
    });

    const assessments = await read(book);
    const byId = new Map(assessments.in_flight.map((assessment) => [assessment.id, assessment]));

    expect([assessments.open_count, assessments.stopped_count]).toEqual([4, 3]);
    expect(byId.get(measured)).toMatchObject({
      verdict: 'open',
      window: { due: instantText(afterSpan(live).due) },
      stopped: { at: instantText(live + hour), run: 'run-4', reason: noSale },
    });
    expect(byId.get(failed)?.stopped).toEqual({
      at: instantText(live + 2 * hour),
      run: 'failed-run',
      reason: 'The lookup of the orders failed.',
    });
    expect(byId.get(going)).not.toHaveProperty('stopped');
    expect(byId.get(unexplained)?.stopped).toEqual({ at: instantText(live + 3 * hour), run: 'run-14' });
  });

  it('are no longer stopped once judged, and keep their stop out of the read and the count', async () => {
    const book = assessmentBookOf();
    const measured = await stoppedByItsMeasurement(book);
    const before = await stoppedColumnsOf(book, measured);
    await book.assessed(measured, 'failed', afterSpan(live).due, 'final');

    const assessments = await read(book);

    expect(before).toEqual([live + hour, 'run-4']);
    expect(await stoppedColumnsOf(book, measured)).toEqual([null, null]);
    expect([assessments.open_count, assessments.stopped_count]).toEqual([0, 0]);
    expect(assessments.current).not.toHaveProperty('stopped');
  });
});
