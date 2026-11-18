import { describe, expect, it } from 'vitest';

import { unopened } from '../assessments/assessment-state.ts';
import {
  assessmentBookOf,
  controlsGoal,
  day,
  experimentsGoal,
  firstDay,
  inTurn,
  thingAt,
  type AssessmentBook,
} from '../reads/assessment-samples.ts';
import { dismissalNoticesOf } from './dismissal-notices.ts';
import { dismissedLatelyBefore, lately, mostDismissedLatelyRead, type DismissedLately } from './dismissed-lately.ts';

const katy = 'person:user_katy';

const live = firstDay + day;

const now = live + day;

const minute = 60_000;

function thingsOf(book: AssessmentBook, pers: readonly string[]): Promise<readonly string[]> {
  return inTurn(pers, (per) => thingAt(book, { per, at: firstDay, marked: ['chosen'], live }));
}

describe('the things a caller dismissed lately', () => {
  it('are the other standing dismissals of the same caller in the playbook within the last few minutes, newest first, by their per', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const [older, newer, earlier, byAnother, restored, thisOne] = await thingsOf(book, [
      'MAR-1',
      'MAR-2',
      'MAR-3',
      'MAR-4',
      'MAR-5',
      'MAR-6',
    ]);
    await book.dismissed(String(older), katy, now - 2 * minute);
    await book.dismissed(String(newer), katy, now - minute);
    await book.dismissed(String(earlier), katy, now - lately.millis - minute);
    await book.dismissed(String(byAnother), 'person:user_sam', now - minute);
    await book.dismissed(String(restored), katy, now - minute);
    await book.restored(String(restored), katy, now - minute);
    await book.dismissed(String(thisOne), katy, now);

    const lateOnes = await book.inThePlaybook(dismissedLatelyBefore({ id: String(thisOne), by: katy, at: now }));

    expect(lateOnes).toEqual([
      { id: newer, per: 'MAR-2' },
      { id: older, per: 'MAR-1' },
    ]);
  });

  it('are read up to a cap, and a thing with no per is named by its id', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal, controlsGoal]);
    const pers = Array.from({ length: mostDismissedLatelyRead + 1 }, (_, index) => `MAR-${String(index)}`);
    const things = await thingsOf(book, pers);
    const calendar = await book.opened(controlsGoal, firstDay, {
      window: { opens: firstDay, closes: live, due: live },
    });
    await inTurn([...things, calendar], (thing, index) => book.dismissed(thing, katy, now - minute + index));

    const lateOnes = await book.inThePlaybook(dismissedLatelyBefore({ id: 'not-dismissed', by: katy, at: now }));

    expect(lateOnes).toHaveLength(mostDismissedLatelyRead);
    expect(lateOnes[0]).toEqual({ id: calendar });
  });
});

describe('the notice of the things dismissed lately', () => {
  const dismissal = { at: firstDay, by: { id: katy, name: 'Katy' }, requests: [] };

  it('is given only when the caller dismissed other things lately, and names the first few of them', () => {
    const others: readonly DismissedLately[] = [
      { id: 'thing-without-a-per' },
      ...Array.from({ length: mostDismissedLatelyRead - 1 }, (_, index) => ({
        id: `thing-${String(index)}`,
        per: `${'A long name of a thing '.repeat(3)}${String(index)}`,
      })),
    ];

    const [alone, several] = [[], others].map((lateOnes: readonly DismissedLately[]) =>
      dismissalNoticesOf(unopened, dismissal, lateOnes),
    );

    expect(alone?.map(({ kind }) => kind)).toEqual(['dismissed_for_everyone']);
    expect(several?.map(({ kind, certainty }) => [kind, certainty])).toEqual([
      ['dismissed_for_everyone', 'reminder'],
      ['dismissed_several', 'reminder'],
    ]);
  });
});
